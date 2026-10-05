use crate::{Error, Result, crypto::MAX_BYTES};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

struct Event {
    owner: Option<String>,
    coalesce: Option<String>,
    value: String,
}
#[derive(Default)]
pub(crate) struct Events {
    queue: VecDeque<Event>,
    bytes: usize,
}
impl Events {
    pub fn pop(&mut self) -> Option<String> {
        let event = self.queue.pop_front()?;
        self.bytes -= event.value.len();
        Some(event.value)
    }
    pub fn remove_owner(&mut self, id: &str) {
        self.queue.retain(|event| {
            if event.owner.as_deref() == Some(id) {
                self.bytes -= event.value.len();
                false
            } else {
                true
            }
        });
    }
    pub fn push(&mut self, v: &Value) -> Result<Vec<String>> {
        let value = v.to_string();
        if value.len() > MAX_BYTES {
            return Err(Error::Overflow);
        }
        let owner = (v["type"] == "event")
            .then(|| v["subscriptionId"].as_str().map(str::to_owned))
            .flatten();
        let coalesce = match v["type"].as_str() {
            Some("state") => Some("state".to_owned()),
            Some("upload_progress" | "upload_complete" | "upload_error") => {
                v["uploadId"].as_str().map(|id| format!("upload:{id}"))
            }
            _ => None,
        };
        if let Some(key) = &coalesce {
            self.queue.retain(|event| {
                if event.coalesce.as_ref() == Some(key) {
                    self.bytes -= event.value.len();
                    false
                } else {
                    true
                }
            });
        }
        let mut retired = Vec::new();
        if let Some(id) = &owner {
            let owned = self
                .queue
                .iter()
                .filter(|event| event.owner.as_ref() == Some(id));
            let (count, bytes) = owned.fold((0, 0), |(count, bytes), event| {
                (count + 1, bytes + event.value.len())
            });
            if count >= 32 || bytes + value.len() > 16 * 1024 * 1024 {
                self.remove_owner(id);
                retired.push(id.clone());
                return Ok(retired);
            }
        }
        let (count_limit, byte_limit) = if owner.is_some() {
            (112, 60 * 1024 * 1024)
        } else {
            (128, 64 * 1024 * 1024)
        };
        while self.queue.len() >= count_limit || self.bytes + value.len() > byte_limit {
            let mut owners: HashMap<&str, (usize, usize)> = HashMap::new();
            for event in &self.queue {
                if let Some(id) = event.owner.as_deref() {
                    let budget = owners.entry(id).or_default();
                    budget.0 += 1;
                    budget.1 += event.value.len();
                }
            }
            // Attribute pressure to existing queued ownership, never simply
            // to the next innocent producer that encounters a full queue.
            let victim = owners
                .into_iter()
                .max_by_key(|(_, (count, bytes))| {
                    if self.bytes + value.len() > byte_limit {
                        *bytes
                    } else {
                        *count
                    }
                })
                .map(|(id, _)| id.to_owned())
                .ok_or(Error::Overflow)?;
            self.remove_owner(&victim);
            retired.push(victim.clone());
            if owner.as_ref() == Some(&victim) {
                return Ok(retired);
            }
        }
        self.bytes += value.len();
        self.queue.push_back(Event {
            owner,
            coalesce,
            value,
        });
        Ok(retired)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn flooder_does_not_retire_an_innocent_producer() {
        let mut events = Events::default();
        for id in ["a", "b", "c", "d"] {
            for n in 0..28 {
                assert!(
                    events
                        .push(&json!({"type":"event","subscriptionId":id,"n":n}))
                        .unwrap()
                        .is_empty()
                );
            }
        }
        let retired = events
            .push(&json!({"type":"event","subscriptionId":"healthy"}))
            .unwrap();
        assert_eq!(retired.len(), 1);
        assert_ne!(retired[0], "healthy");
        assert!(
            events
                .queue
                .iter()
                .any(|event| event.owner.as_deref() == Some("healthy"))
        );
        assert!(
            !events
                .queue
                .iter()
                .any(|event| event.owner.as_ref() == retired.first())
        );
    }
    #[test]
    fn upload_progress_coalesces_without_saturating_control_capacity() {
        let mut events = Events::default();
        for n in 0..300 {
            events
                .push(&json!({"type":"upload_progress","uploadId":"owned","n":n}))
                .unwrap();
        }
        events
            .push(&json!({"type":"upload_complete","uploadId":"owned"}))
            .unwrap();
        assert_eq!(events.queue.len(), 1);
        assert!(events.pop().unwrap().contains("upload_complete"));
        assert_eq!(events.bytes, 0);
    }
}
