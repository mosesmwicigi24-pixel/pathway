# API Contracts → Surfaces

> Which endpoint group is consumed by which surface. The **OpenAPI spec**
> (`packages/shared/src/openapi/openapi.yaml`) is the authoritative contract; this file is the
> human-readable consumer map. Pair it with [docs/PARITY.md](./docs/PARITY.md).
>
> **Surfaces:** **W** = Web portal (`packages/admin-web`) · **iP** = iPad app (`pathwayforipad`)
> · **M** = Mobile member app (`packages/mobile`) · **S2S** = server-to-server.
>
> Rule of thumb: `/admin/*` → **W + iP** · member paths (`/me/*`, `/giving/*`, `/chat/*`,
> `/calendar`, `/growth/*`, `/levels`, `/modules`, `/prayer-wall/*`, …) → **M** ·
> `/auth/*` → all clients · `/webhooks/*` → **S2S**. Exceptions are called out below.

## Admin surface (`/admin/*`) — Web + iPad

| Group | Endpoints | W | iP | Notes |
|---|---|:--:|:--:|---|
| Reports | /admin/reports/{overview,engagement,attendance,levels,consents} | ✅ | ✅ | Dashboard, Cells, Curriculum, People Intelligence |
| Analytics | /admin/analytics/intelligence | ✅ | ⚠️ | **Web only today**; iPad should adopt (PARITY D-05) |
| Audit | /admin/audit | ✅ | ✅ | SuperAdmin |
| Notifications | /admin/notifications (+:action) | ✅ | ✅ | |
| Cells | /admin/cells (+:id, /homepage) | ✅ | ✅ | Cell Engagement |
| Members | /admin/members (+:id, results, enrollment, graduation) | ✅ | ✅ | |
| Reflections | /admin/reflections (+:id/decision, history) | ✅ | ✅ | Review queue |
| Finance (read) | /admin/finance/{summary,transactions(:id),ledger,trend,audit,config} | ✅ | ✅ | Read-only, PCI SAQ-A |
| Events ops | /admin/events/series(+:id, exceptions, homepage, pause, resume); /admin/events/:id/{attendance,rsvps,checkins,guests} | ✅ | ✅ | |
| Announcements | /admin/announcements (+:id, send, cancel, homepage, video) | ✅ | ✅ | |
| Moments | /admin/moments (+:id) | ✅ | ✅ | |
| Curriculum | /admin/levels(+:n, exam, modules); /admin/modules(+:id, publish, unpublish, reorder, versions); /admin/modules/:id/questions; /admin/questions/:id; /admin/preview | ✅ | ✅ | iPad lacks `/admin/preview` (D-06) |
| Growth content | /admin/growth/{devotionals,memory-verses,plans,resources,daily-verses} | ✅ | ✅ | |
| Encouragements | /admin/levels/:n/encouragements; /admin/encouragements/:id | ✅ | ⚠️ | **iPad missing** (D-04) |
| Media | /admin/media (+:id, external, thumbnail, homepage, images/sign); video pipeline (uploads, videos/chunk, videos/finalize) | ✅ | ⚠️ | iPad: external/URL only; no chunked video upload (D-03) |
| Certificates | /admin/certificates (+:id/revoke) | ✅ | ✅ | + public `/verify/:code` |
| Badges | /admin/badges (+:code, reactivate); /admin/members/:id/badges/:code/revoke | ✅ | ✅ | |
| System | /admin/{users,roles(:key/permissions),congregations,countries,languages} | ✅ | ✅ | Reference data + RBAC |
| Website | /admin/enquiries (+:id/ack) | ✅ | ☐ | Gated on the `website` RBAC module, not a role tier. Intake is S2S `/webhooks/website-contact` (HMAC). iPad pending. |
| Community mod | /admin/community/threads/:id; /admin/community/comments/:id/hide | ✅ | ❌ | Web only |

## Chat & moderation — mixed

| Endpoints | M | W | iP | Notes |
|---|:--:|:--:|:--:|---|
| /chat/conversations(+:id, messages, read), /chat/people, /chat/dms, /chat/spaces(+join), /chat/messages/:id/{reactions,readers,edit,delete}, /chat/attachments/sign | ✅ | ✅ | ✅ | Member chat + admin oversight share the base |
| /chat/messages/:id/{flag,unflag,remove,restore} | ❌ | ✅ | ✅ | **Moderation** — admin only |
| /assistant/{chat,history} | ✅ | — | ✅ | iPad has an assistant pane; web N/A |

## Member surface — Mobile

| Group | Endpoints |
|---|---|
| Auth | /auth/{login,login/mfa,register,password/forgot,password/reset,token/refresh,logout,mfa/*,oauth/:provider} |
| Me / profile | /me (+PATCH), /me/password, /me/activity, /me/avatar, /me/devices, /me/onboarding |
| Home | /me/home/{greeting,next-action,verse,verse/reactions}, /me/rhythm/{today,complete}, /home/{featured-event,featured-announcement,featured-cell,welcome-video,disciplers,prayer-wall} |
| Pathway / learning | /levels, /me/pathway, /levels/:n/{modules,exam,encouragements}, /modules/:id (+complete, quiz, quiz/attempts, reflection), /scripture |
| Growth | /growth/{devotional,memory-verses,plans(:id),segments/:id/complete,resources,mentor} |
| Scores | /me/scores (+/word,/prayer,/habits,/curriculum,/attendance) |
| Giving | /giving/{intents,paypal/capture,history,transactions/:id(/receipt.pdf),statement.pdf,schedules(/:id/cancel)}; /products(/:id/purchase) |
| Prayer / verses | /prayer-wall/* , /me/prayers(+/:id/share-to-wall), /me/verses |
| Events (member) | /calendar(/series, parse), /events/:id (+rsvp, posts), /me/{rsvps,cell-summary}, /moments |
| Community | /community/threads (+:id/comments) |
| Gifts / gamification | /gifts/*, /me/gifts, /me/achievements, /badges, /cells/:id/milestones |
| Notifications | /me/notifications (+read), /me/announcements, /announcements/:id (+open) |
| Onboarding | /onboarding (+steps/*, literacy-quiz, finalize), /directory/cell-groups |
| Sync (offline) | /sync/{pull,push} — the member system of record |

## Server-to-server (S2S)

| Endpoints | Notes |
|---|---|
| /webhooks/stripe | Stripe payment settlement |
| /webhooks/mobilemoney/:provider | M-Pesa / Airtel callbacks |

## Known wire-level notes

- **Terminology mix:** `/admin/cells` + `/me/cell-summary` (new) coexist with `/cohorts/:cell_id/members` + `/cells/:id/milestones`. Plan an additive rename (PARITY D-09).
- **Engagement module** routes (`/members/:id/engagement`, `/relationships`, `/cohorts/...`) are role-gated in-handler and carry **no `/admin` or `/me` prefix** — a strict prefix split miscategorizes them. They are leader/portal-facing.
- **Giving** supports both Stripe (`/giving/intents`) and PayPal (`/giving/paypal/capture`); mobile currently drives PayPal capture.
