# The verified Alpine archive is the base; no mutable registry base tag.
FROM scratch
ADD alpine.tar.gz /
COPY apks/ /tmp/host-apks/
RUN /sbin/apk add --no-network /tmp/host-apks/*.apk && rm -rf /tmp/host-apks
ADD codex-package.tar.gz /opt/codex/
COPY claude/ /opt/claude/
COPY yep/ /opt/yep/
COPY runtime/ /opt/host/
RUN addgroup -g 1000 user \
    && adduser -D -u 1000 -G user -h /home/user -s /bin/bash user \
    && ln -s user /home/host \
    && install -m 440 /opt/host/user.sudoers /etc/sudoers.d/user \
    && visudo -c \
    && chmod 755 /home /opt/claude/claude /opt/host/ya \
    && ln -s /opt/host/ya /usr/bin/ya
COPY runtime/hostname /etc/hostname
COPY runtime/hosts /etc/hosts
ENV HOME=/home/user USER=user LOGNAME=user SHELL=/bin/bash HOSTNAME=ya-phone
USER 1000:1000
WORKDIR /home/user
CMD ["/usr/bin/node", "/opt/host/launch.mjs"]
