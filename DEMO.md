# Demo script

~10 minutes. Two browser windows side by side: the **Template Sync dashboard** on the left, the **Contentful source space** (content model) on the right.

## Before you start

- [ ] `npm run sync -- --dry-run` shows "No changes" and lists your target environments.
- [ ] Dashboard shows every target **Up to date**.
- [ ] Webhook is active in the source space (check *Webhooks → Activity log* for a recent 200).
- [ ] `AUTO_INSTALL_MODE=additive-only`.
- [ ] Pick a **throwaway field name** for each scenario below and make sure it doesn't already exist.

## 1. Set the scene (1 min)

> "Our content model lives in one source space. A *content model template* is a versioned copy of it, and it's installed in several customer spaces. Today, keeping those in step means someone re-exports and re-installs by hand. This app does it from a webhook."

Point at the dashboard: template name, latest version, and the **"How a change flows"** strip — *Source model → Webhook → Template → Installs*. When everything is in sync all four steps show a green tick and the connectors shimmer green.

## 2. Live additive change — the ripple (3 min)

1. In the source space open the content type that's part of the template (e.g. *Blog post*).
2. **Add a field** — e.g. `Reading time` (Integer, ID `readingTime`).
3. **Save**, then **Publish** the content type.
4. Switch to the dashboard and watch (it refreshes every 5s). The moment a new version lands, the four steps **light up one after another** (the "Replay" button re-runs that on demand):
   - **What changed in the model** shows *Before → After* for the content type, with the new `readingTime` chip popping in green.
   - The header jumps to **v+1**, and *Version history* shows a green **ADDITIVE** badge with `Field "readingTime" (Integer) added`.
   - Glowing dots travel along the connector into **Installs**; the target moves **Installing…** (blue, spinner) → **Up to date** (green tick) at the new version.

> "No one touched the customer spaces. Contentful validated the new version against each environment first, then installed it."

Optional proof: open one target space → content model → the new field is there.

## 3. Additive tweaks (1 min)

Change the *validation* (e.g. max length on the title) or the *appearance* (field editor widget) and publish / save. Same ripple, another green **ADDITIVE** version. These are safe because existing content stays valid.

## 4. A breaking change is held (3 min)

1. In the source space, **delete a field** (or change its type) on the content type and publish.
2. Dashboard: a new version appears with a red **BREAKING** badge and `Field "…" removed`.
3. The removed field shows struck through in red under *Before*. A purple **lock** appears on the connector into **Installs**, and target rows turn purple **Held** — "Breaking change held for review". Nothing was installed.

> "The template is up to date so we can review it, but we don't push a destructive change into customer spaces automatically. A human decides."

4. Click **Install latest** on **one** environment. The row goes **Installing…** → **Up to date**, the others remain **Held**.

## 4b. Show your working — the API trace (2 min)

Open the **API trace** tab. It auto-runs a read-only dry run, then walk the audience down the timeline:

1. **Blue GET cards** — the app reads the template and the source content type + editor interface. Point at *Sent* vs *Received*.
2. **Purple Mapping cards** — the same content type, left as Contentful returns it, right as the template stores it: `sys` dropped, `basedOn` link kept, fields copied 1:1.
3. **Dark Decision cards** — *identical or changed?*, *additive or breaking?*, *hold or install?*.
4. After you make a change, **Run sync now** (or **Install latest**) and the tab fills with the **real** calls, including the orange `PUT` that creates the new template version, the *Check only* validation per environment, and the `POST` install. The "N writes" chip tells you exactly what changed in Contentful.

> "Nothing is hidden: these are the actual requests. The Authorization header is never shown."

## 5. No webhook? Force it (30s)

Click **Run sync now**. If the template already matches the source you'll see *"already matches the source model — nothing to do"* — that's the idempotency guard. This button is also your safety net if a webhook delivery is ever missed.

## 6. Wrap-up talking points

- The webhook endpoint requires a **shared secret** (header or Basic Auth); anything outside the source space/environment is ignored (so installing into other spaces can't loop back).
- **Deleting** a content type is logged but never propagated.
- `AUTO_INSTALL_MODE` is the policy knob: `additive-only`, `all`, or `manual`.
- Everything on the dashboard is read live from Contentful — no database to keep in sync.

## Rehearsing without touching Contentful

Add `?preview=` to the dashboard URL to overlay **simulated** state (nothing is written; an amber banner says so):

| URL | Shows |
|---|---|
| `/?preview=installing` | An additive change mid-install: travelling dots, spinner on every target |
| `/?preview=held` | A breaking change (field removed) held behind the lock |
| `/?preview=behind` | Targets waiting to be installed |

## Resetting between runs

- Re-add a deleted field in the source space and publish: that produces an additive version, then **Install latest** on the held environments (or **Run sync now**) to bring everyone level.
- Or install the latest version on each held environment from the dashboard.
- Use a different field ID each time — template versions are append-only.
