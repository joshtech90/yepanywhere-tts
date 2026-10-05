//! The platform verifier uses Android's application classloader and trust manager.
use jni::{
    EnvUnowned,
    errors::ThrowRuntimeExAndDefault,
    jni_mangle,
    objects::{JClass, JObject},
};

#[jni_mangle("com.yepanywhere.mobile.connection.YaRustTls")]
pub fn initialize<'caller>(
    mut env: EnvUnowned<'caller>,
    _class: JClass<'caller>,
    context: JObject<'caller>,
) {
    env.with_env(|env| rustls_platform_verifier::android::init_with_env(env, context))
        .resolve::<ThrowRuntimeExAndDefault>();
}
