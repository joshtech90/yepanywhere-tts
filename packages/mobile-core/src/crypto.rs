//! YA's existing integer/proof profile over RustCrypto SRP, not new arithmetic.
use crate::{Error, Result, check};
use base64::{Engine, engine::general_purpose::STANDARD};
use libsodium_sys as sodium;
use serde_json::{Value, json};
use sha2::{Digest, Sha512};
use srp::{ClientG2048, Group, bigint::BoxedUint, groups::G2048};
use std::sync::OnceLock;
use zeroize::Zeroizing;

pub const MAX_BYTES: usize = 32 * 1024 * 1024;
pub fn hash(parts: &[&[u8]]) -> Zeroizing<Vec<u8>> {
    let mut h = Sha512::new();
    for part in parts {
        h.update(part);
    }
    Zeroizing::new(h.finalize().to_vec())
}
pub fn random(size: usize) -> Result<Zeroizing<Vec<u8>>> {
    let mut bytes = Zeroizing::new(vec![0; size]);
    getrandom::fill(&mut bytes).map_err(|_| Error::Unavailable)?;
    Ok(bytes)
}
fn ready() -> Result<()> {
    static READY: OnceLock<bool> = OnceLock::new();
    // SAFETY: no pointers, thread-safe library initialization.
    check(*READY.get_or_init(|| unsafe { sodium::sodium_init() >= 0 }))
}
pub fn same(a: &[u8], b: &[u8]) -> Result<bool> {
    ready()?;
    if a.len() != b.len() {
        return Ok(false);
    }
    // SAFETY: valid readable slices, exact length, no mutation.
    Ok(unsafe { sodium::sodium_memcmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0 })
}
pub fn seal(bytes: &[u8], nonce: &[u8], key: &[u8]) -> Result<Vec<u8>> {
    ready()?;
    check(bytes.len() <= MAX_BYTES && nonce.len() == 24 && key.len() == 32)?;
    let mut output = vec![0; bytes.len() + 16];
    // SAFETY: disjoint buffers; output includes the MAC, fixed key/nonce sizes.
    check(
        unsafe {
            sodium::crypto_secretbox_easy(
                output.as_mut_ptr(),
                bytes.as_ptr(),
                bytes.len() as u64,
                nonce.as_ptr(),
                key.as_ptr(),
            )
        } == 0,
    )?;
    Ok(output)
}
pub fn open(bytes: &[u8], nonce: &[u8], key: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    ready()?;
    check((16..=MAX_BYTES + 16).contains(&bytes.len()) && nonce.len() == 24 && key.len() == 32)?;
    let mut output = Zeroizing::new(vec![0; bytes.len() - 16]);
    // SAFETY: disjoint buffers and exact required readable/writable lengths.
    check(
        unsafe {
            sodium::crypto_secretbox_open_easy(
                output.as_mut_ptr(),
                bytes.as_ptr(),
                bytes.len() as u64,
                nonce.as_ptr(),
                key.as_ptr(),
            )
        } == 0,
    )?;
    Ok(output)
}
pub fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}
pub fn unb64(text: &str) -> Result<Vec<u8>> {
    check(text.len() <= (MAX_BYTES + 16) * 4 / 3 + 4)?;
    STANDARD.decode(text).map_err(|_| Error::InvalidMessage)
}
pub fn field<'a>(v: &'a Value, name: &str) -> Result<&'a str> {
    v[name].as_str().ok_or(Error::InvalidMessage)
}
pub fn json_open(text: &str, key: &[u8]) -> Result<Value> {
    check(text.len() <= 64 * 1024)?;
    let v: Value = serde_json::from_str(text)?;
    let plain = open(
        &unb64(field(&v, "ciphertext")?)?,
        &unb64(field(&v, "nonce")?)?,
        key,
    )?;
    Ok(serde_json::from_slice(&plain)?)
}
pub fn json_seal(v: &Value, key: &[u8]) -> Result<String> {
    let bytes = Zeroizing::new(serde_json::to_vec(v)?);
    let nonce = random(24)?;
    Ok(json!({"nonce":b64(&nonce), "ciphertext":b64(&seal(&bytes, &nonce, key)?)}).to_string())
}
pub fn transport_key(base: &[u8], nonce: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    check(base.len() == 32 && nonce.len() == 24)?;
    Ok(Zeroizing::new(
        hash(&[b"yep-transport-v1", base, nonce])[..32].to_vec(),
    ))
}
fn minimal(bytes: &[u8]) -> &[u8] {
    &bytes[bytes
        .iter()
        .position(|x| *x != 0)
        .unwrap_or(bytes.len() - 1)..]
}
fn integer(text: &str) -> Result<Vec<u8>> {
    check(!text.is_empty() && text.len() <= 512 && text.bytes().all(|c| c.is_ascii_hexdigit()))?;
    let bytes = hex::decode(if text.len().is_multiple_of(2) {
        text.to_owned()
    } else {
        format!("0{text}")
    })
    .map_err(|_| Error::InvalidMessage)?;
    Ok(minimal(&bytes).to_vec())
}
pub struct SrpProof {
    pub a: String,
    pub m1: String,
    expected: Zeroizing<Vec<u8>>,
    base: Zeroizing<Vec<u8>>,
}
impl SrpProof {
    pub fn challenge(password: &[u8], salt: &str, b: &str) -> Result<Self> {
        Self::with_private(password, salt, b, &random(48)?)
    }
    fn with_private(password: &[u8], salt: &str, b: &str, private: &[u8]) -> Result<Self> {
        let salt = integer(salt)?;
        let b = integer(b)?;
        let group = G2048::generator();
        let public = BoxedUint::from_be_slice_vartime(&b);
        check(public != BoxedUint::zero() && public < *group.params().modulus().as_ref())?;
        let client = ClientG2048::<Sha512>::new();
        let a = client.compute_public_ephemeral(private);
        let x = Zeroizing::new(ClientG2048::<Sha512>::compute_x(&hash(&[password]), &salt));
        let k = srp::utils::compute_k::<Sha512>(&group);
        let u = srp::utils::compute_u_padded::<Sha512>(&group, &a, &b);
        check(u != BoxedUint::zero())?;
        let private = Zeroizing::new(BoxedUint::from_be_slice_vartime(private));
        let s = Zeroizing::new(client.compute_premaster_secret(&public, &k, &x, &private, &u));
        let raw = Zeroizing::new(s.to_be_bytes_trimmed_vartime().to_vec());
        let m1 = hash(&[&a, &b, &raw]);
        let expected = hash(&[&a, minimal(&m1), &raw]);
        let base = Zeroizing::new(hash(&[&raw])[..32].to_vec());
        Ok(Self {
            a: hex::encode(a),
            m1: hex::encode(minimal(&m1)),
            expected,
            base,
        })
    }
    pub fn verify(self, m2: &str) -> Result<Zeroizing<Vec<u8>>> {
        let proof = integer(m2)?;
        check(proof.len() <= 64)?;
        let mut padded = [0; 64];
        padded[64 - proof.len()..].copy_from_slice(&proof);
        check(same(&self.expected, &padded)?)?;
        Ok(self.base)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn production_profile_matches_typescript_vectors() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        for path in [
            "android/app/src/sharedTest/resources/ya-secure-interop-v1.json",
            "mobile-core-proof/test-vectors/minimal-public-unicode.json",
            "mobile-core-proof/test-vectors/minimal-m1.json",
        ] {
            let v: Value =
                serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap();
            let srp = &v["srp"];
            let proof = SrpProof::with_private(
                field(srp, "password").unwrap().as_bytes(),
                field(srp, "salt").unwrap(),
                field(srp, "B").unwrap(),
                &integer(field(srp, "clientPrivate").unwrap()).unwrap(),
            )
            .unwrap();
            assert_eq!(
                integer(&proof.a).unwrap(),
                integer(field(srp, "A").unwrap()).unwrap()
            );
            assert_eq!(
                integer(&proof.m1).unwrap(),
                integer(field(srp, "M1").unwrap()).unwrap()
            );
            let base = proof.verify(field(srp, "M2").unwrap()).unwrap();
            assert_eq!(hex::encode(&*base), field(srp, "baseKeyHex").unwrap());
        }
    }
    #[test]
    fn rejects_public_values_before_arithmetic() {
        for value in ["0", "xyz", "", &"f".repeat(513)] {
            assert!(SrpProof::challenge(b"fixture-password", "ab", value).is_err());
        }
        let n = hex::encode(G2048::generator().params().modulus().as_ref().to_be_bytes());
        assert!(SrpProof::challenge(b"fixture-password", "ab", &n).is_err());
    }
    #[test]
    fn rejects_tampered_ciphertext() {
        let key = random(32).unwrap();
        let nonce = random(24).unwrap();
        let mut sealed = seal(b"fixture", &nonce, &key).unwrap();
        assert_eq!(&*open(&sealed, &nonce, &key).unwrap(), b"fixture");
        sealed[0] ^= 1;
        assert!(open(&sealed, &nonce, &key).is_err());
        assert!(open(&sealed, &[0; 23], &key).is_err());
    }
}
