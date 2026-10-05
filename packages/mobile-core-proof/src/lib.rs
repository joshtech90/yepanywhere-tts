//! Compatibility experiment only: no application dependency or login API.
//! RustCrypto performs every SRP modular exponentiation. YA's adapter only
//! supplies the existing password hash, integer encodings and proof profile.

use base64::{Engine, engine::general_purpose::STANDARD};
use libsodium_sys as sodium;
use num_bigint::BigUint;
use serde_json::Value;
use sha2::{Digest, Sha512};
use srp::{client::SrpClient, groups::G_2048, server::SrpServer, utils};
use std::sync::OnceLock;
use zeroize::Zeroizing;

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum ProofError {
    #[error("Invalid proof input: {check}")]
    InvalidInput { check: String },
    #[error("Compatibility check failed: {check}")]
    Mismatch { check: String },
}

#[derive(uniffi::Record, Debug)]
pub struct ProofReport {
    pub vector_checks: Vec<String>,
    pub rejection_checks: Vec<String>,
    pub sodium_version: String,
}

type Result<T> = std::result::Result<T, ProofError>;

fn invalid(check: &str) -> ProofError {
    ProofError::InvalidInput {
        check: check.into(),
    }
}

fn require(ok: bool, check: &str) -> Result<()> {
    if ok { Ok(()) } else { Err(invalid(check)) }
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value[name].as_str().ok_or_else(|| invalid(name))
}

fn integer(value: &str) -> Result<BigUint> {
    require(!value.is_empty() && value.len() <= 512, "integer length")?;
    BigUint::parse_bytes(value.as_bytes(), 16).ok_or_else(|| invalid("hex integer"))
}

fn hex_bytes(value: &Value, name: &str) -> Result<Vec<u8>> {
    let text = field(value, name)?;
    hex::decode(text).map_err(|_| invalid(name))
}

fn b64(value: &Value, name: &str) -> Result<Vec<u8>> {
    STANDARD
        .decode(field(value, name)?)
        .map_err(|_| invalid(name))
}

fn hash(parts: &[&[u8]]) -> Vec<u8> {
    let mut digest = Sha512::new();
    for part in parts {
        digest.update(part);
    }
    digest.finalize().to_vec()
}

fn pad(value: &BigUint) -> Result<Vec<u8>> {
    let bytes = value.to_bytes_be();
    require(bytes.len() <= 256, "SRP group width")?;
    let mut padded = vec![0; 256];
    padded[256 - bytes.len()..].copy_from_slice(&bytes);
    Ok(padded)
}

fn public_value(value: &BigUint) -> Result<()> {
    require(
        value < &G_2048.n && value != &BigUint::default(),
        "SRP public value",
    )
}

fn sodium_ready() -> Result<()> {
    static READY: OnceLock<bool> = OnceLock::new();
    // SAFETY: libsodium's initializer is thread-safe and accepts no pointers.
    require(
        *READY.get_or_init(|| unsafe { sodium::sodium_init() >= 0 }),
        "libsodium initialization",
    )
}

fn same(left: &[u8], right: &[u8]) -> Result<bool> {
    sodium_ready()?;
    if left.len() != right.len() {
        return Ok(false);
    }
    // SAFETY: both slices contain exactly len readable bytes for this call.
    Ok(unsafe {
        sodium::sodium_memcmp(left.as_ptr().cast(), right.as_ptr().cast(), left.len()) == 0
    })
}

fn seal(message: &[u8], nonce: &[u8], key: &[u8]) -> Result<Vec<u8>> {
    sodium_ready()?;
    require(
        nonce.len() == 24 && key.len() == 32,
        "secretbox key/nonce length",
    )?;
    let mut ciphertext = vec![0; message.len() + 16];
    // SAFETY: output has message.len()+MAC bytes; input, nonce and key lengths
    // match crypto_secretbox_easy's contract and do not alias the output.
    let code = unsafe {
        sodium::crypto_secretbox_easy(
            ciphertext.as_mut_ptr(),
            message.as_ptr(),
            message.len() as u64,
            nonce.as_ptr(),
            key.as_ptr(),
        )
    };
    require(code == 0, "secretbox seal")?;
    Ok(ciphertext)
}

fn open(ciphertext: &[u8], nonce: &[u8], key: &[u8]) -> Result<Option<Zeroizing<Vec<u8>>>> {
    sodium_ready()?;
    require(
        nonce.len() == 24 && key.len() == 32,
        "secretbox key/nonce length",
    )?;
    if ciphertext.len() < 16 {
        return Ok(None);
    }
    let mut plaintext = Zeroizing::new(vec![0; ciphertext.len() - 16]);
    // SAFETY: readable ciphertext has at least MAC bytes; output has the exact
    // required plaintext length and nonce/key were validated above.
    let code = unsafe {
        sodium::crypto_secretbox_open_easy(
            plaintext.as_mut_ptr(),
            ciphertext.as_ptr(),
            ciphertext.len() as u64,
            nonce.as_ptr(),
            key.as_ptr(),
        )
    };
    Ok(if code == 0 { Some(plaintext) } else { None })
}

fn binary_open(envelope: &[u8], key: &[u8]) -> Result<Option<Zeroizing<Vec<u8>>>> {
    if envelope.len() < 42 || envelope[0] != 1 {
        return Ok(None);
    }
    let Some(inner) = open(&envelope[25..], &envelope[1..25], key)? else {
        return Ok(None);
    };
    if inner.first() != Some(&1) {
        return Ok(None);
    }
    Ok(Some(Zeroizing::new(inner[1..].to_vec())))
}

fn transport_key(base: &[u8], nonce: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    require(
        base.len() == 32 && nonce.len() == 24,
        "transport key inputs",
    )?;
    Ok(Zeroizing::new(
        hash(&[b"yep-transport-v1", base, nonce])[..32].to_vec(),
    ))
}

struct Transcript {
    a: BigUint,
    b: BigUint,
    x: BigUint,
    v: BigUint,
    k: BigUint,
    u: BigUint,
    s: BigUint,
    m1: Vec<u8>,
    m2: Vec<u8>,
}

fn transcript(srp: &Value, password: &str) -> Result<Transcript> {
    require(
        srp["groupBits"] == 2048 && srp["hash"] == "SHA-512",
        "SRP profile",
    )?;
    require(
        integer(field(srp, "N")?)? == G_2048.n && integer(field(srp, "g")?)? == G_2048.g,
        "SRP group",
    )?;
    let client = SrpClient::<Sha512>::new(&G_2048);
    let a_private = integer(field(srp, "clientPrivate")?)?;
    let a = client.compute_a_pub(&a_private);
    let b = integer(field(srp, "B")?)?;
    public_value(&a)?;
    public_value(&b)?;
    let salt = integer(field(srp, "salt")?)?.to_bytes_be();
    let password_hash = Zeroizing::new(hash(&[password.as_bytes()]));
    let x = SrpClient::<Sha512>::compute_x(&password_hash, &salt);
    let v = client.compute_v(&x);
    let k = utils::compute_k::<Sha512>(&G_2048);
    // The high-level process_reply uses unpadded A/B and username:password.
    // Public library hooks allow YA's profile without replacing SRP arithmetic.
    let u = utils::compute_u::<Sha512>(&pad(&a)?, &pad(&b)?);
    require(u != BigUint::default(), "SRP scrambling parameter")?;
    let s = client.compute_premaster_secret(&b, &k, &x, &a_private, &u);
    let raw_s = Zeroizing::new(s.to_bytes_be());
    let m1_digest = utils::compute_m1::<Sha512>(&a.to_bytes_be(), &b.to_bytes_be(), &raw_s);
    let m1 = BigUint::from_bytes_be(&m1_digest).to_bytes_be();
    // YA encodes M1 as a minimal integer, including in the M2 hash. The
    // library's compute_m2 always accepts a full digest, so encode explicitly.
    let m2 = BigUint::from_bytes_be(&hash(&[&a.to_bytes_be(), &m1, &raw_s])).to_bytes_be();
    Ok(Transcript {
        a,
        b,
        x,
        v,
        k,
        u,
        s,
        m1,
        m2,
    })
}

fn check(ok: bool, label: &str, checks: &mut Vec<String>) -> Result<()> {
    if !ok {
        return Err(ProofError::Mismatch {
            check: label.into(),
        });
    }
    checks.push(label.into());
    Ok(())
}

// Compare the newer crypto-bigint backend without adopting its prerelease API
// or claiming this profile adapter is constant-time or independently audited.
fn next_backend_matches(srp: &Value, old: &Transcript) -> Result<bool> {
    use srp_next::{ClientG2048, Group, ServerG2048, bigint::BoxedUint, groups::G2048};
    type Hash = sha2_next::Sha512;
    let boxed = |value: &BigUint| BoxedUint::from_be_slice_vartime(&value.to_bytes_be());
    let client = ClientG2048::<Hash>::new();
    let server = ServerG2048::<Hash>::new();
    let group = G2048::generator();
    let a_private = integer(field(srp, "clientPrivate")?)?;
    let b_private = integer(field(srp, "serverPrivate")?)?;
    let a = client.compute_public_ephemeral(&a_private.to_bytes_be());
    let password_hash = Zeroizing::new(hash(&[field(srp, "password")?.as_bytes()]));
    let salt = integer(field(srp, "salt")?)?.to_bytes_be();
    let x = ClientG2048::<Hash>::compute_x(&password_hash, &salt);
    let v = client.compute_g_x(&x);
    let k = srp_next::utils::compute_k::<Hash>(&group);
    let u = srp_next::utils::compute_u_padded::<Hash>(&group, &a, &old.b.to_bytes_be());
    let s = client.compute_premaster_secret(&boxed(&old.b), &k, &x, &boxed(&a_private), &u);
    let raw = Zeroizing::new(s.to_be_bytes_trimmed_vartime().to_vec());
    let m1_digest = srp_next::utils::compute_m1_legacy::<Hash>(&a, &old.b.to_bytes_be(), &raw);
    let m1 = BigUint::from_bytes_be(&m1_digest).to_bytes_be();
    let m2 = BigUint::from_bytes_be(&hash(&[&a, &m1, &raw])).to_bytes_be();
    let server_b = server.compute_b_pub(&boxed(&b_private), &k, &v);
    let server_s = server.compute_premaster_secret(&boxed(&old.a), &v, &u, &boxed(&b_private));
    let matches = same(&a, &old.a.to_bytes_be())?
        && same(&x.to_be_bytes_trimmed_vartime(), &old.x.to_bytes_be())?
        && same(&v.to_be_bytes_trimmed_vartime(), &old.v.to_bytes_be())?
        && same(&k.to_be_bytes_trimmed_vartime(), &old.k.to_bytes_be())?
        && same(&u.to_be_bytes_trimmed_vartime(), &old.u.to_bytes_be())?
        && same(&raw, &old.s.to_bytes_be())?
        && same(&m1, &old.m1)?
        && same(&m2, &old.m2)?
        && same(
            &server_b.to_be_bytes_trimmed_vartime(),
            &old.b.to_bytes_be(),
        )?
        && same(
            &server_s.to_be_bytes_trimmed_vartime(),
            &old.s.to_bytes_be(),
        )?;
    Ok(matches)
}

fn proof_json(proof: &Value, key: &[u8]) -> Result<Value> {
    let plaintext = open(&b64(proof, "ciphertext")?, &b64(proof, "nonce")?, key)?
        .ok_or_else(|| invalid("proof authentication"))?;
    serde_json::from_slice(&plaintext).map_err(|_| invalid("proof JSON"))
}

fn resume_matches(value: &Value, session: &str, client: &str, server: &str) -> bool {
    value["type"] == "srp_resume_server_proof"
        && value["sessionId"] == session
        && value["clientNonce"] == client
        && value["serverNonce"] == server
        && value["resumeProtocolVersion"] == 3
}

/// Runs public test vectors only. Returns check names, never computed secrets.
#[uniffi::export]
pub fn verify_interop_fixture(fixture_json: String) -> Result<ProofReport> {
    require(fixture_json.len() <= 65536, "fixture size")?;
    let fixture: Value =
        serde_json::from_str(&fixture_json).map_err(|_| invalid("fixture JSON"))?;
    require(fixture["schemaVersion"] == 1, "fixture version")?;
    let srp = &fixture["srp"];
    let t = transcript(srp, field(srp, "password")?)?;
    let mut vectors = Vec::new();
    let mut rejections = Vec::new();
    for (label, value) in [
        ("A", &t.a),
        ("B", &t.b),
        ("x", &t.x),
        ("verifier", &t.v),
        ("k", &t.k),
        ("u", &t.u),
        ("S", &t.s),
    ] {
        check(*value == integer(field(srp, label)?)?, label, &mut vectors)?;
    }
    check(
        same(&t.m1, &integer(field(srp, "M1")?)?.to_bytes_be())?,
        "M1",
        &mut vectors,
    )?;
    check(
        same(&t.m2, &integer(field(srp, "M2")?)?.to_bytes_be())?,
        "M2",
        &mut vectors,
    )?;
    check(
        next_backend_matches(srp, &t)?,
        "SRP 0.7 RC transcript",
        &mut vectors,
    )?;
    let server = SrpServer::<Sha512>::new(&G_2048);
    let server_private = integer(field(srp, "serverPrivate")?)?;
    check(
        server.compute_b_pub(&server_private, &t.k, &t.v) == t.b,
        "server B",
        &mut vectors,
    )?;
    check(
        server.compute_premaster_secret(&t.a, &t.v, &t.u, &server_private) == t.s,
        "server S",
        &mut vectors,
    )?;
    let raw = Zeroizing::new(t.s.to_bytes_be());
    check(
        same(&raw, &hex_bytes(srp, "rawSessionKeyHex")?)?,
        "raw S encoding",
        &mut vectors,
    )?;
    let base = Zeroizing::new(hash(&[&raw])[..32].to_vec());
    check(
        same(&base, &hex_bytes(srp, "baseKeyHex")?)?,
        "base key",
        &mut vectors,
    )?;
    let full = &fixture["fullSession"];
    let transport = transport_key(&base, &b64(full, "transportNonce")?)?;
    check(
        same(&transport, &hex_bytes(full, "transportKeyHex")?)?,
        "transport key",
        &mut vectors,
    )?;
    let resume = &fixture["resume"];
    let resumed = transport_key(&base, &b64(resume, "serverNonce")?)?;
    check(
        same(&resumed, &hex_bytes(resume, "transportKeyHex")?)?,
        "resumed transport key",
        &mut vectors,
    )?;
    check(
        !same(&transport, &resumed)?,
        "fresh transport keys",
        &mut vectors,
    )?;
    for (label, proof, plaintext) in [
        (
            "server info secretbox",
            &full["serverInfoProof"],
            field(full, "serverInfoPlaintext")?,
        ),
        (
            "resume client secretbox",
            &resume["proof"],
            field(resume, "proofPlaintext")?,
        ),
        (
            "resume server secretbox",
            &resume["serverProof"],
            field(resume, "serverProofPlaintext")?,
        ),
    ] {
        let nonce = b64(proof, "nonce")?;
        let ciphertext = b64(proof, "ciphertext")?;
        check(
            same(&seal(plaintext.as_bytes(), &nonce, &base)?, &ciphertext)?,
            label,
            &mut vectors,
        )?;
        let opened = open(&ciphertext, &nonce, &base)?.ok_or_else(|| invalid(label))?;
        check(
            same(&opened, plaintext.as_bytes())?,
            &format!("{label} open"),
            &mut vectors,
        )?;
        let mut tampered = ciphertext.clone();
        tampered[0] ^= 1;
        check(
            open(&tampered, &nonce, &base)?.is_none(),
            &format!("{label} tampering"),
            &mut rejections,
        )?;
    }
    let info = proof_json(&full["serverInfoProof"], &base)?;
    check(
        info["type"] == "srp_verify_server_info"
            && info["sessionId"] == full["sessionId"]
            && info["transportNonce"] == full["transportNonce"]
            && info["resumeProtocolVersion"] == 3,
        "authenticated server info",
        &mut vectors,
    )?;
    let proof = proof_json(&resume["serverProof"], &base)?;
    let session = field(full, "sessionId")?;
    let client_nonce = field(resume, "clientNonce")?;
    let server_nonce = field(resume, "serverNonce")?;
    check(
        resume_matches(&proof, session, client_nonce, server_nonce),
        "resume challenge binding",
        &mut vectors,
    )?;
    for (label, s, c, n) in [
        ("wrong resume session", "wrong", client_nonce, server_nonce),
        ("wrong client nonce", session, "wrong", server_nonce),
        ("wrong server nonce", session, client_nonce, "wrong"),
    ] {
        check(!resume_matches(&proof, s, c, n), label, &mut rejections)?;
    }
    let binary = &fixture["binaryEnvelope"];
    require(binary["format"] == 1, "binary format")?;
    let nonce = b64(binary, "nonce")?;
    let mut inner = vec![1];
    inner.extend_from_slice(field(binary, "plaintext")?.as_bytes());
    let mut envelope = vec![1];
    envelope.extend_from_slice(&nonce);
    envelope.extend_from_slice(&seal(&inner, &nonce, &transport)?);
    check(
        same(&envelope, &b64(binary, "envelopeBase64")?)?,
        "binary envelope",
        &mut vectors,
    )?;
    let opened = binary_open(&envelope, &transport)?.ok_or_else(|| invalid("binary open"))?;
    check(
        same(&opened, field(binary, "plaintext")?.as_bytes())?,
        "binary envelope open",
        &mut vectors,
    )?;
    let mut bad = envelope.clone();
    bad[0] = 2;
    check(
        binary_open(&bad, &transport)?.is_none(),
        "wrong binary version",
        &mut rejections,
    )?;
    bad = envelope.clone();
    bad[25] ^= 1;
    check(
        binary_open(&bad, &transport)?.is_none(),
        "binary tampering",
        &mut rejections,
    )?;
    check(
        binary_open(&envelope[..41], &transport)?.is_none(),
        "truncated envelope",
        &mut rejections,
    )?;
    let mut bad_key = base.to_vec();
    bad_key[0] ^= 1;
    check(
        open(
            &b64(&full["serverInfoProof"], "ciphertext")?,
            &b64(&full["serverInfoProof"], "nonce")?,
            &bad_key,
        )?
        .is_none(),
        "wrong secretbox key",
        &mut rejections,
    )?;
    check(
        seal(b"test", &[0; 23], &base).is_err(),
        "short nonce",
        &mut rejections,
    )?;
    check(
        seal(b"test", &[0; 24], &[0; 31]).is_err(),
        "short key",
        &mut rejections,
    )?;
    for (label, b) in [
        ("zero SRP B", BigUint::default()),
        ("N SRP B", G_2048.n.clone()),
        ("oversized SRP B", &G_2048.n + &G_2048.n),
    ] {
        check(public_value(&b).is_err(), label, &mut rejections)?;
    }
    let wrong_password = transcript(srp, "different public fixture password")?;
    check(
        !same(&wrong_password.m2, &t.m2)?,
        "wrong password proof",
        &mut rejections,
    )?;
    let mut wrong_m2 = t.m2.clone();
    wrong_m2[0] ^= 1;
    check(!same(&wrong_m2, &t.m2)?, "tampered M2", &mut rejections)?;
    // SAFETY: libsodium returns a static, NUL-terminated version string.
    let sodium_version = unsafe { std::ffi::CStr::from_ptr(sodium::sodium_version_string()) }
        .to_string_lossy()
        .into_owned();
    Ok(ProofReport {
        vector_checks: vectors,
        rejection_checks: rejections,
        sodium_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURE: &str =
        include_str!("../../android/app/src/sharedTest/resources/ya-secure-interop-v1.json");

    #[test]
    fn production_fixture_and_adversarial_checks() {
        let report = verify_interop_fixture(FIXTURE.into()).unwrap();
        assert_eq!(report.vector_checks.len(), 27);
        assert_eq!(report.rejection_checks.len(), 17);
    }

    #[test]
    fn corrupt_or_unsupported_fixture_fails_without_secret_values() {
        assert!(verify_interop_fixture("{".into()).is_err());
        let mut fixture: Value = serde_json::from_str(FIXTURE).unwrap();
        fixture["srp"]["M2"] = Value::String("00".into());
        let error = verify_interop_fixture(fixture.to_string()).unwrap_err();
        assert_eq!(error.to_string(), "Compatibility check failed: M2");
    }

    #[test]
    fn production_edge_vectors() {
        for fixture in [
            include_str!("../test-vectors/minimal-public-unicode.json"),
            include_str!("../test-vectors/minimal-m1.json"),
        ] {
            let report = verify_interop_fixture(fixture.into()).unwrap();
            assert_eq!(report.vector_checks.len(), 27);
            assert_eq!(report.rejection_checks.len(), 17);
        }
    }
}
