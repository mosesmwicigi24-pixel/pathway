-- The God of Systems: NEW 10-day plan seeded from the author's PDF (source of truth).
-- Each day: key verse (scripture) -> Devotional -> Talk it Over -> Pray (+blessing) -> Go Deeper.
-- Re-runnable: plan upserts by code and days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration

INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('the-god-of-systems', 'The God of Systems', 'Ten days with the Divine Architect — learning the systems thinking that turns chaos into increase.', 'Open your Bible to its first page and watch God work: He does not merely create things — He creates systems. Lights to govern seasons, seed inside fruit to regenerate harvests, everything commanded to reproduce after its kind. Knowing God means understanding His modus operandi, and His modus operandi is creating systems. Many of us live and labor in fragments — gifted but disorganized, anointed but structureless, working hard and wearing out. This plan is the shift: from thinking in parts to thinking in systems. Ten days with the Divine Architect: why darkness is simply the absence of systems, what Jethro saw that Moses missed, why your capacity decides your oil — and how order, everywhere and always, creates increase.', 'Wisdom', 10, 28, 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'the-god-of-systems');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Genesis 1:1, 3', 'The Divine Architect'),
  (2, 'Genesis 1:2', 'Darkness Is the Absence of Systems'),
  (3, 'Genesis 1:28', 'Everything God Makes Reproduces'),
  (4, 'Acts 6:7', 'Order Creates Increase'),
  (5, 'Exodus 18:17–18', 'Jethro: The Counsel That Saved Moses'),
  (6, '2 Kings 4:6', 'Your Capacity Decides Your Oil'),
  (7, '1 Corinthians 9:25', 'Anointing Without Structure Is Lightning in the Sky'),
  (8, 'Job 42:8; Genesis 20:7', 'People Who Are Systems of God'),
  (9, 'Exodus 25:40', 'Built Twice: Spirit First, Then Structure'),
  (10, 'Luke 14:28', 'Build Your Systems — and Keep Building')
) AS v(n, ref, title) WHERE p.code = 'the-god-of-systems';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'the-god-of-systems'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Genesis 1:1, 3', $dev$“In the beginning God created the heavens and the earth… And God said, “Let there be light,” and there was light.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Watch the Architect at work in Genesis 1: day separated from night to govern time; lights appointed for seasons and years; waters gathered, land ordered, every plant carrying seed “according to their kinds.” Creation is not a warehouse of objects — it is an interlocking system of systems, each one designed to run, reproduce and produce results.

And the Architect’s Son? “Through him all things were made” (John 1:3), and “in him all things hold together” (Colossians 1:17). Christ is not only the Creator of the systems — He is their coherence. The universe holds together in Him the way a body holds together by life.

To know this God is to learn His way of working: He establishes systems and principles that set processes in motion, and processes produce results. Ten days from now, you will think noticeably more like the Architect.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you currently work more like a laborer of moments or an architect of systems?

— What in your life produces results only when you personally push — and what runs by design?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Divine Architect, Father of order, apprentice me. Teach me Your modus operandi — systems that run, reproduce and produce — beginning with the life You gave me to govern. Amen.

_May the Architect’s apprenticeship begin visibly in your life this week._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 1; Colossians 1:15–17$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Genesis 1:2', $dev$“Now the earth was formless and empty, darkness was over the surface of the deep, and the Spirit of God was hovering over the waters.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Before the first system, the earth’s condition is described in three words: formless, empty, dark. Mark the diagnosis, for it still holds: one characteristic of the lack of systems is darkness that covers all. Darkness, in this deep sense, is the lack of God’s light — and the lack of understanding of how realms operate (Ephesians 1:17–18).

You have seen it: the brilliant person whose finances are formless; the anointed work that is empty of structure; the home, business or ministry where confusion “covers all.” Not cursed — un-systematized.

But read what hovers over every formless deep: the Spirit of God — and then the Word: “Let there be light.” Chaos is not your permanent address; it is raw material awaiting the Architect. Name your formless areas today without despair: the same Spirit is hovering, and light is His specialty.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Which area of your life best matches “formless, empty, dark” right now?

— What would “let there be light” — understanding of how that realm operates — look like there?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Spirit of God, hover over my deep. Speak light into my formless places — understanding of how things operate — and begin the ordering that ends the darkness. Amen.

_May light dawn this week over the most formless area of your life._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 1:1–5; Ephesians 1:17–18$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Genesis 1:28', $dev$“God blessed them and said to them, “Be fruitful and increase in number; fill the earth and subdue it.””$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Everything God ever created, He created as a system able to reproduce, regenerate and produce results — seed in the fruit, blessing in the command: prosper, reproduce, fill, take charge. Nothing in Eden was designed to be consumed to extinction; everything was designed to multiply.

Here is the principle in a fruit: we eat the flesh and throw the seed — but if we plant the seed, we get more fruit, endlessly. The seed is the principle that controls the experience; understand the principle, and you can reproduce the experience over and over again.

This transforms how you handle every success: do not merely enjoy the fruit — extract the seed. The prayer that was answered: what principle produced it? The month the business flourished: what system was running? Document the seed, plant it deliberately, and turn one-time experiences into perpetual harvests. That is thinking like the Architect.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Recall a recent success: did you eat the fruit and discard the seed?

— Extract one seed today — write down the principle behind something that worked.$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, teach me seed-thinking. Let me never again consume a blessing without extracting its principle — and make my life a field of replanted, multiplying seed. Amen.

_May every fruit you eat this season leave a planted seed behind it._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 1:11–12, 28; Mark 4:26–29$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Acts 6:7', $dev$“So the word of God spread. The number of disciples in Jerusalem increased rapidly…”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$When you think systems, you think structure; structure creates order — and order creates increase. The reverse is equally biblical: disorganization shows poverty, and often produces it.

Watch the principle rescue the early church: growth had outrun structure, widows were being overlooked, and the apostles were drowning in distribution. Their solution was not more anointing — it was a system: seven trusted men appointed over the serving. Read what follows immediately: “So the word of God spread. The number of disciples increased rapidly.” The system unlocked the increase.

The same God who multiplied loaves first “directed them to have all the people sit down in groups” — order before miracle (Mark 6:39–40). So invite order into your formless places practically: the budget written, the diary kept, the roles defined, the drawer sorted. It is not carnal administration; it is preparing seats for multiplication.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has growth outrun structure in your life or work — your Acts 6 moment?

— What one ordering act — budget, schedule, roles — will you complete this week?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$God of order, I stop despising structure. Seat my life in groups like the loaves crowd — and let every act of ordering become a seat for Your multiplication. Amen.

_May new order in your house make room for increase you have prayed years for._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 6:1–7; Mark 6:39–44; 1 Corinthians 14:40$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Exodus 18:17–18', $dev$“Moses’ father-in-law replied, “What you are doing is not good. You and these people who come to you will only wear yourselves out.””$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Moses — mighty, called, anointed — was drowning: alone on the judgment seat from morning till night, a nation queuing before one man. It took a visiting father-in-law one day to diagnose it: what you are doing is not good; you will wear yourself out. Moses was not lacking anointing. He was lacking a system — and later, under the same weight, he even prayed to die (Numbers 11:15). Burnout is often not a spiritual failure; it is a structural one.

Jethro’s prescription was pure systems thinking: keep what only you can do (represent the people before God, teach the ways); delegate the rest to capable, God-fearing, unbribable leaders of thousands, hundreds, fifties and tens; let difficult cases rise, and routine ones settle low.

And God Himself later echoed the counsel, taking of the Spirit on Moses and putting it on seventy elders — for seventy-one prophesying is better than one. Who carries what only you should release? Build your tens and fifties.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Where are you “Moses at the seat” — doing alone what a system should carry?

— Name your potential leaders of tens and fifties. What will you hand them first?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, send me Jethro’s eyes for my own life. Show me what only I must carry, and give me courage to build and trust the tens and fifties — before I wear out. Amen.

_May wise delegation give you back the years burnout was scheduling to take._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 18:13–26; Numbers 11:10–17, 24–25$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '2 Kings 4:6', $dev$“When all the jars were full, she said to her son, “Bring me another one.” But he replied, “There is not a jar left.” Then the oil stopped flowing.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Study the widow’s miracle closely: the oil — heaven’s supply — flowed exactly as long as there were vessels to receive it. The moment the jars ran out, the oil stopped. The supply was unlimited; the capacity was not. Where our capacities stop, the resources stop.

Jesus taught the same law with wineskins: new wine demands new skins, or the old ones burst and both are lost (Luke 5:37–38). Heaven’s resources wait on prepared containers.

Remember the fisherman who threw the biggest fish back because they could not fit his frying pan at home? Our minds are like that frying pan: when the idea, the opportunity, the assignment exceeds our capacity, we toss it back to the river — and blame scarcity. It was never a problem of opportunities; it is a problem of capacity. So gather jars deliberately: enlarge skills, structures, teams, and faith. The oil is ready to keep flowing.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What “big fish” have you tossed back because it exceeded your current pan?

— Which jars will you gather this season — skill, structure, team, faith?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Lord of the oil, I stop blaming the supply. Enlarge my pan, multiply my jars, renew my wineskin — and let Your flow find in me a capacity that never cuts it short. Amen.

_May your growing capacity keep heaven’s oil flowing past every old stopping point._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$2 Kings 4:1–7; Luke 5:36–39$dev$),
  (7, 1, 'scripture', 'Today''s Reading', '1 Corinthians 9:25', $dev$“Everyone who competes in the games goes into strict training…”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Hear one of the Architect’s sharpest proverbs: anointing without structure is like lightning in the sky — spectacular, powerful, and lighting nothing. But the same electricity, run through the structure of wires and bulbs, lights a whole city every night. Structure is what turns raw power into sustained light.

This resolves a painful mystery: gifted people who flash and fade, movements that blaze and vanish, personal seasons of fire that left nothing built. The power was real; the wiring was missing.

So wire your gift deliberately. The evangelist needs a follow-up system or converts scatter; the intercessor needs rhythms or fire visits instead of dwelling; the business needs documentation or it dies with its founder’s moods. Ask of every grace on your life: where is its wiring — the routine, the team, the process that turns my lightning into streetlights?$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has your life flashed like lightning without lighting lasting bulbs?

— Pick one gift: what wiring — routine, team, process — will you build around it?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, wire my anointing. I refuse the spectacular flash that lights nothing — build through me the structures that turn Your power into light cities can live by. Amen.

_May your lightning find wires — and whole streets stay lit because you built them._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 9:24–27; 14:40$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Job 42:8; Genesis 20:7', $dev$“…my servant Job shall pray for you, for I will accept his prayer…” / “Return the man’s wife, for he is a prophet, and he will pray for you and you will live.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is the teaching’s most breathtaking turn: there are men and women who are themselves systems of God — established channels through which heaven has chosen to flow. When God confronted Job’s friends, He routed their restoration through Job: “my servant Job shall pray for you, for I will accept his prayer.” When Abimelek needed his life spared, God pointed to Abraham: “he is a prophet, and he will pray for you and you will live.”

Grasp both directions of this. First: recognize the systems of God placed around you — the intercessor, the mentor, the man or woman whose prayer heaven has attached to your matter — and honor them (the reward system taught you how).

Second, and greater: become one. A person of tested character, established prayer and proven faithfulness, through whom God can reliably route blessing to families, churches and cities. That is system-hood of the highest order — and it is built by everything this journey has been forming in you.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Who are the “systems of God” placed around your life — and have you honored them?

— What would becoming a reliable channel — for your family, church, city — require of you next?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, open my eyes to the systems of God around me, and grace me to become one — a tested, reliable channel through whom You can bless many. Route Your flow through me. Amen.

_May heaven come to trust your life as a route for other people’s breakthroughs._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Job 42:7–10; Genesis 20:1–7, 17$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Exodus 25:40', $dev$“See that you make them according to the pattern shown you on the mountain.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Anything that exists in the physical and lasts is built twice — first in the spiritual, then in the physical. The tabernacle was complete on the mountain before a single pole stood in the desert: “make them according to the pattern shown you.” Jesus Himself had a book in heaven before a body on earth.

This is why prayer and planning are not rivals but partners: in the secret place you receive the pattern; at the desk and worksite you build it. Man is a spirit living in a body, given a mind as the bridge — and most believers have never learned to transfer spiritual realities across that bridge into physical frames. The pattern stays on the mountain; the desert stays empty.

So practice the double build: take your assignment to the mountain until you can see it; then write it plainly (Habakkuk 2:2) and build what you saw — organogram, calendar, budget, team. Spirit first, structure faithfully after. That is how eternity enters geography.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which of your visions is still “on the mountain” — seen but never transferred to a buildable pattern?

— Schedule the double build: when is the mountain time, and when is the drafting table?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, show me the pattern on the mountain — then steady my hands at the drafting table. I will build twice: received in the spirit, erected in the earth, exact to what You showed me. Amen.

_May everything shown to you on the mountain stand finished in the valley._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 25:8–9, 40; Hebrews 8:5; Habakkuk 2:2–3$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Luke 14:28', $dev$“Suppose one of you wants to build a tower. Won’t you first sit down and estimate the cost…?”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Now the commissioning — practical as a builder’s checklist. Start small and grow the systems as you grow. Define the operational level: the departments of your life and work, each with its purpose. Let data serve planning: reports, reviews, honest measurement — what have you done today toward the objective? Do not joke with meetings — even God does meetings; gather your people and your own soul regularly for review and alignment.

Build a training system, for it standardizes the development of people — document what you have learned and teach it (“when you have turned back, strengthen your brothers”). And keep a strategy system: look five years ahead, ten years ahead; watch the changes coming — and ask what opportunities the changes create.

Above all, remember whose systems they are: in the Kingdom we do not own things; we are stewards. The systemic nature of God brings predictability to your success — whatever you have that you cannot keep, you did not gain by understanding. Build by understanding. The Architect is pleased to share His blueprints with His children.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Which system will you build first — operations, data, meetings, training, or strategy?

— Look five years ahead: what changes are coming, and what opportunities do they create for you?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Divine Architect, I take up the builder’s checklist as Your steward. Give me blueprints, patience to start small, and faithfulness to keep building — until my life runs on Your order and produces Your increase. Amen.

_May you build, by understanding, what your grandchildren will still be running._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 14:28–30; Proverbs 24:3–4, 27$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
