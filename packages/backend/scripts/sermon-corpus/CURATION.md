# Sermon corpus — what goes into the app, and what never does

Source: the owner's Google Drive `Sermons` folder
(`1-2meLsEFowrAAI6NRp1gebejU7lEHThO`), reviewed 2026-08-11. The owner approved
this include/exclude split before any line could reach a member.

The corpus feeds the daily liturgy's quote library: short teaching lines **in
the owner's own voice**, attributed to him and traceable to the source
document. His own words are the primary voice; public-domain classics are the
supporting cast.

---

## INCLUDE — the owner's own preaching (~30 documents)

`great quotes.docx` is the single richest source: pure aphorism, already
distilled, no Scripture to strip.

| Drive file id | Title |
|---|---|
| 1UzyrIc_qC6DWFA3wiOdCk4nFQ7hpHCyc | great quotes |
| 1bUToLNjP7FHxKriNT_ks79P0HSLW0FaD | Change your mindset |
| 1u-rgAzijCrEPx6uwGqHxmiDnvwbG6tAq | All things new |
| 15GvcYr35oCHP7aJpPhB8zqSTLPnmC9p6 | Bearing Fruits |
| 1Anl6a-cVeq2FQIYhE3bC0e-G8ygSr2L8 | An army of simple men |
| 1ktgDeTMxEcxL2sTx64ExgBRCZtxiah1h | Influencing — the salt |
| 1iKwLRvUoBm4s2iQgqgo71IosRbakFFi- | God of systems |
| 1WmXNdG6SmJN5y4hZleY2u2gCxh4MXEm5 | Leadership |
| 1-VWfZ2hDpa5-NQ4UCqew2axV06GOZyG3 | Look, see beyond the horizon |
| 1ONAylHOzQKjtnuDmOeFOpeehR7PrTo15 | Love |
| 19Ygu9W6EsXojenijZRxc7KiIUo2KqLDj | Leader without a title |
| 1dGkRkFgmbFmhrEkaoaN_EHwtJ9ewAzje | Knowing your Assignment |
| 1acKywRmduKtLr0OvlblqlPYsTkhWjIBP | Killing the small foxes |
| 1-OH9uloh23dDUmeG8yjliGZdLRDuZB8r | Keeping your vows |
| 1d2yuc-AezG5XjsWPMDoAEqTpJMWyAo2E | Holy Communion |
| 1JEL4S8Fm4hROqmrDsYXYP9HePjV_-wCS | How much is one man's gift |
| 11-ELq_JdMFLU32F0UTtomj5bGEUOSdt2 | Faith |
| 1oOfE2C4lFUcLM8n60yOOHdKI0uVmEaL6 | God of new Grace |
| 1TRJDNiDSNqIl4JdOv29HA0FcTLjJuuG4 | Destiny |
| 1htUfwYWrZtZXaR8OK7jn2v8NIGEHPNeK | Cost to pay for revival |
| 1bEerBEUBRfbbk0h7DhqQUb3o1-POXtg- | The Power of Becoming |
| 1Ldl4W-nn17KKgYQ8bErP4j_pMm4dYdKt | Hearing from the Lord: Dreams |
| 1PykmKwvDCCa2ksOPLVAhlJukoZijVGSK | Gates and Doors |
| 1ERFIfUrX1Z4q2M_uKvt4eHILEvZY6-yr | Gatekeepers |
| 1aJLKG4FxkcmznV0lPMHLFPM1lTHmVqkv | Covenants |
| 1Oap790UGC7CVYB9Z7pz0UcY9W8C9Htia | Altars and Covenants |
| 15Yhv2E31wYeypm0RekRk7aK47gv2acGu | Be transformed |
| 1IrVHl71aJ8y5MgJndYntpzOXwnLEW1vG | Heavenly Marriages |
| 1DrQTmckqtg2jBkqQz9uDEH2sCmU5eLpU | God will exempt you from death during this Passover |
| 1tssH8Qi6gTxyYZ_aO4WbSUEcbWlTvkzi | He is coming like a thief (PDF) |
| 1WV5-cny5uM5jnxVTCAvt3LoxMFg532hCfGPGwlMniG0 | The power to become — right questioning |

---

## EXCLUDE

### 1. Not preaching — administration and machine litter
`Income.xlsx`, `Copy of Lower Kabete Christian Union .xlsx`, `Default.rdp`,
seven `~WRL####.tmp` Word crash-recovery files, `Document 1.docx`,
`Bethany Gift Shop`, `Bethany Design Brief`, `The Good News Mission Hospital`,
`5 Years Vision` (all copies), `Online Outreach center.pptx`,
`Ablaze Worship Vision Plan`, `BluePrint 2070`.

A member opening the app at sunrise should not meet a budget spreadsheet.

### 2. Real preaching, wrong context — EXCLUDED FROM THE LITURGY ONLY
`Defilement through witchcraft`, `Defilement through sexual engagements and
occultism`, `Abuse of Sex and Sexual altars`, `Demonic Legal Ground`,
`Dealing with evil Foundations`.

These are genuine sermons and stay available in the church's teaching. They are
kept out of the **unprompted daily card** because a member meeting this
material at 6am, with no context and no pastor present, is a pastoral harm the
app would be causing. Context is consent: a person choosing to open a teaching
on spiritual warfare is not the same as one being handed it over breakfast.

### 3. NEVER — other people's copyrighted books
The owner's Drive also holds published works by other authors (e.g. E. A.
Adeboye, Reinhard Bonnke). **These must never enter the corpus.** Publishing
another author's book text daily inside a product is infringement, whatever
the attribution. Only the owner's own words, and genuinely public-domain
classics (Spurgeon, Tozer, Chambers, Murray, Bounds, Carmichael, Augustine),
may be quoted verbatim.

### 4. Duplicates
Most documents exist 2-4 times (`Copy of …`, `Destiny(1)`, `Leadership1/2/3`,
Courts of Heaven as both .docx and .pdf). Ingest ONE canonical copy each —
otherwise the same line resurfaces repeatedly, which is the exact repetition
complaint this whole effort exists to fix.

---

## Addendum — found during extraction (2026-08-12), not caught by the original review

All 31 INCLUDE documents were staged to `packages/backend/scripts/sermon-corpus/*.txt`
verbatim. Reading the actual text surfaced five documents that this list approved for
INCLUDE but that turn out, on inspection, not to be safe to attribute to the owner as
quotable teaching. They are staged (for audit) but **excluded from quote extraction**;
each staged file carries its own `# EXCLUDED FROM QUOTE EXTRACTION:` header line.

| Document | Why it doesn't qualify |
|---|---|
| `Leadership` ("The Power of Self-Leadership") | The owner's own book manuscript, but it has large verbatim, unattributed blocks copied from a John Piper sermon/article (desiringgod-style, biblia.com links) and a Forbes.com article by Shelley Zalis quoting Robyn Ward. No reliable way to separate the owner's own writing from the copied material throughout a 50K-character document. |
| `The Power of Becoming` | A second book manuscript with the same DEDICATION/ACKNOWLEDGMENTS/About-the-Author shape as Leadership, and an explicit trailing citation to David Powlison / crossway.org confirming embedded third-party material. |
| `Heavenly Marriages` | Large sections are verbatim Facebook posts (with a named photographer credit), an excerpt from the Crossway.org book *God's Design for Man and Woman* by Andreas J. and Margaret E. Köstenberger (full author bios included), and material from dadabhagwan.org attributed to a named spiritual teacher. |
| `Influencing — the salt` | Opens "Speaker: David Nganga" — a guest speaker, not the owner. Attributing any line here to the owner would be a misattribution, not just a copyright issue. |
| `Leader without a title` | A set of disconnected, ungrammatical secular aphorisms with no first-person/pastoral voice and no Scripture at all (unlike every other file in this corpus); the title matches a well-known leadership book, and one line ("...biggest libraries") matches a widely circulated quote not written by the owner. Excluded out of caution — not proven, but the voice doesn't match his verified writing elsewhere in this corpus. |

Two more, narrower findings:

- **`Be transformed`** is otherwise genuine and was kept, but it contains one embedded
  paragraph block (the same Piper "Christ-exalting Christians" / Message-paraphrase
  passage found in `Leadership`) that the extractor specifically blocklists by exact
  string match — see `KNOWN_NON_ORIGINAL_LINES` in `teachingQuotes.ts`.
- **`Holy Communion`** / **`Covenants`** contain a block of "Ten brief observations"
  commentary that quotes a named theologian (I. H. Marshall) with a page citation —
  clearly copied from a published article, not the owner's own words. It's long-form
  prose (each "observation" is a full paragraph), so the extractor's own length/URL
  filters exclude it without needing a special case; `Covenants` also has that block
  elided at staging time with an explicit `[NOTE: ...]` marker in the .txt file.

None of this changes the INCLUDE/EXCLUDE table above — it's additive: five approved
documents didn't pass a closer read and are held out of the quote table pending the
owner's own cleanup of the source files, should he want to revisit them.

Separately, several INCLUDE documents (`Gates and Doors`, `Gatekeepers`, `Covenants`,
`Altars and Covenants`, `Hearing from the Lord: Dreams`) are heavy with witchcraft/
curses/demonic-covenant subject matter — thematically the same pastoral-harm concern
CURATION.md's EXCLUDE §2 already applies to the sensitive-context sermons ("a member
meeting this material at 6am... is a pastoral harm the app would be causing"). The
extractor applies a sensitivity-keyword filter to individual candidate lines from
every document (not just the EXCLUDE §2 list) so a stray "witchcraft destroys your
finances"-style aphorism can never surface unprompted on Home, even though the
documents themselves remain in the INCLUDE set and in the church's own teaching.
