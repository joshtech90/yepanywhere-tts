# Minisign interoperability fixture

`message.txt.minisig` was generated with the official minisign 0.12 Windows
binary using a disposable test key. Only its public key is retained. This
fixture verifies YA's OpenSSL-backed signature reader against an independent
implementation. It is not a product release or a trusted production key.

The signed `message.txt` payload is marked `-text` in the root `.gitattributes`
so Git preserves its exact bytes, including line endings, on every platform.
Converting its LF to CRLF invalidates the signature.
