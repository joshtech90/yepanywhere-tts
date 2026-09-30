---
title: iPad and iPhone Home Screen
description: Add Yep Anywhere to an iPad or iPhone Home Screen so it opens like an app, and stay signed in.
---

Yep Anywhere has no App Store app. Safari can instead add it to the Home
Screen as a web app: it gets its own icon, opens full screen without Safari's
address bar, and appears in the app switcher like any other app. These steps
work the same for the owner and for a [limited user](/docs/local-access#limited-users-preview).

Safari, the browser built into the iPad and iPhone, is all you need. Nothing
else has to be installed.

## Before you start

Ask the owner of the server for:

- **The address to open.** Over the relay this is
  [yepanywhere.com/remote](https://yepanywhere.com/remote) (or the owner's own
  hosted client). On a home network or Tailscale it is the server's address,
  such as `http://192.168.1.50:3400`.
- **The server name**, when connecting over the relay.
- **Your username and password.** A limited user has their own; leave the
  username blank only if you are the owner.

## Add the icon

1. Open **Safari** and go to the address above.
2. Tap the **Share** button (a square with an arrow pointing up). On an iPad it
   sits near the top right of the Safari window; on an iPhone, at the bottom.
3. Tap **View More**, then **Add to Home Screen**.
4. Make sure **Open as Web App** is turned on.
5. Tap **Add**. The Yep Anywhere icon appears on the Home Screen.

You can add it before or after signing in; the next section explains why you
sign in again anyway.

## Sign in once, inside the Home Screen app

Tap the new icon to open it. The Home Screen app keeps its own sign-in,
separate from Safari, so it usually asks you to sign in even if you already
did in Safari. Sign in there once:

- **Over the relay**: tap **Connect via Relay**, enter the **Server name**, put
  your username in **Log in as** (blank for the owner), enter the password,
  and leave **Remember me** checked.
- **Directly**: enter your username (blank for the owner) and the password.

Safari may offer to save the password; saving it makes the next sign-in a
single tap.

## Staying signed in

After that first sign-in, tapping the icon opens Yep Anywhere without asking
again, including after closing the app or restarting the iPad. It asks again
when the login ends:

| Connection | You are asked to sign in again after |
| --- | --- |
| Relay, with **Remember me** | 7 days without opening it, or 30 days after signing in |
| Direct | 30 days after signing in |

Signing out, a password change by the owner, or the owner disabling or
removing a limited account also ends the login.

## Removing it

Touch and hold the icon and choose the option to remove it, as for any app.

## Troubleshooting

- **The icon opens a Safari tab with an address bar.** It was added with
  **Open as Web App** off. Remove it and add it again with the option on.
- **It shows the login page every time.** Make sure **Remember me** is
  checked on the relay login, and sign in from the Home Screen icon rather
  than in Safari.
- **"Server is not connected to the relay."** The host computer is off, asleep,
  or its relay is disabled. Ask the owner to check
  **Settings → Remote Access**.
- More connection checks are in [Remote access](/docs/remote-access) and
  [Troubleshooting](/docs/troubleshooting).
