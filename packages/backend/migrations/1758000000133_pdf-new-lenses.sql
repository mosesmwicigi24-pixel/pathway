-- New Lenses: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'new-lenses');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Luke 24:31', 'The Opener of Eyes'),
  (2, 'Proverbs 29:18', 'What You See Is What You Become'),
  (3, 'Ephesians 1:18', 'Sight Is of the Eyes — Vision Is of the Heart'),
  (4, 'Genesis 13:14–15', 'Abraham''s First Upgrade: Look From Where You Are'),
  (5, 'Genesis 15:5', 'Abraham''s Second Upgrade: Look Up'),
  (6, '1 Samuel 17:36', 'The Lens Laboratory of Hidden Seasons'),
  (7, '1 Samuel 17:26', 'Same Giant, Different Lenses'),
  (8, '2 Corinthians 9:8', 'Vision Travels With Provision'),
  (9, 'Acts 2:17', 'Dare to Dream Again'),
  (10, 'Habakkuk 2:2–3', 'Write the Vision — and Run')
) AS v(n, ref, title) WHERE p.code = 'new-lenses';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'new-lenses'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Luke 24:31', $dev$“Then their eyes were opened and they recognized him…”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Begin with the Optician Himself. Everywhere Jesus went, He opened eyes — blind Bartimaeus on the Jericho road, the man born blind, and on resurrection evening, two discouraged disciples on the Emmaus road whose “eyes were opened and they recognized him.” Note that last case well: their physical eyes had been working all along. What Jesus opened was their seeing.

Discouragement had shown them a dead teacher and a finished story; opened eyes showed them a risen Lord and a story just beginning — same facts, new lenses, burning hearts.

Every upgrade in this plan flows from Him. So start with the blind man's honest prayer, which Jesus loved: “Rabbi, I want to see” (Mark 10:51). He has never refused it yet.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Where might your story look "finished" only because of the lenses you're wearing?

— Pray Bartimaeus' prayer over one specific area: "Lord, I want to see."$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, Opener of eyes — my sight is Yours to upgrade. Where discouragement wrote "the end," open my eyes to the risen truth. Rabbi, I want to see. Amen.

_May your heart burn within you as He opens your eyes on the road this week._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 24:13–35; Mark 10:46–52$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Proverbs 29:18', $dev$“Where there is no vision, the people perish: but he that keepeth the law, happy is he.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Everything you do is the interpretation of what you see from inside you. Before any action leaves your hands, it passes through the picture room of your inner vision — and the picture, not the circumstance, gives the orders.

This is why the enemy fights your imagination before he fights your circumstances: if he can corrupt the picture, he can cancel the performance without a single outward battle. A man who sees himself failing has already rehearsed the failure.

And it is why Scripture ties vision to life itself: where there is no vision, people perish — they unravel, drift, scatter. Where vision lives, discipline finds its reason and hope finds its shape. So take inventory today: when you close your eyes and see your future, what plays? That reel, unedited, is your current trajectory. The Optician is ready to edit.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Describe honestly the "reel" that plays when you picture your future.

— Which scene needs the Optician's edit first?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I open the picture room to You. Edit the reel — remove what fear filmed, and load the scenes You wrote before I was born. Amen.

_May the pictures you live from be replaced by the pictures He wrote you from._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 29:18; Habakkuk 2:2–3$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:18', $dev$“I pray that the eyes of your heart may be enlightened in order that you may know the hope to which he has called you…”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Sight is a function of the eyes, but vision is a function of the heart. Sight reports what is; vision perceives what God intends. Sight saw a shepherd boy; vision saw a king. Sight saw fishermen; vision saw apostles. Sight sees your present; vision reads your book.

This is why Paul prays for “the eyes of your heart” to be enlightened — there is an inner set of eyes, and they can be opened, dimmed, or trained.

Vision sets you free from the limitations of what physical eyes can see: the present is never enough for a heart that has seen what God has said. And the freedom is practical — the visionary saves, studies, builds and prays differently, because he has seen where the road goes. Ask today for the Ephesians enlightenment: not new circumstances first, but new eyes first.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— What has "sight" been reporting that "vision" would read differently?

— What do you sense God intends that your eyes cannot yet confirm?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, enlighten the eyes of my heart. Where sight reports limits, let vision read intentions — the hope, the riches, the power of Your calling. Amen.

_May the eyes of your heart out-see the eyes in your head from today._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 1:15–21; 2 Kings 6:15–17$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Genesis 13:14–15', $dev$“The Lord said to Abram after Lot had parted from him, “Look around from where you are, to the north and south, to the east and west. All the land that you see I will give to you.””$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Mark the timing: after Lot had parted from him. Sometimes vision waits for a separation — not from people we hate, but from arrangements that quietly capped our seeing. Only when the land dispute ended did God say, “Now — look around.”

Mark also the boundary of the promise: all the land that you see I will give you. God tied the inheritance to the eyesight! The giving was as large as the looking. What Abraham refused to survey, he could not receive.

And mark the starting point: “from where you are.” Vision does not require a better location; it requires lifted eyes at this one. So stand exactly where life has you — the same job, the same town, the same season — and look again in every direction, deliberately. Ask God to show you what has been standing in plain sight, waiting for a looker.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Has any "Lot" — an arrangement, a dependency — been quietly capping your vision?

— Look around "from where you are": what is God showing that you never surveyed?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, from where I stand — not where I wish I stood — I lift my eyes north, south, east and west. Show me the inheritance that was waiting for a looker. Amen.

_May your inheritance grow to the size of your lifted eyes._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 13:5–18$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Genesis 15:5', $dev$“He took him outside and said, “Look up at the sky and count the stars — if indeed you can count them.” Then he said to him, “So shall your offspring be.””$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$The first upgrade was horizontal — land, measurable, surveyable. The second was of another order entirely. God took Abraham outside — out of his tent, out of his own roofline — and turned his face from the horizon to the heavens: count the stars, if you can.

Horizontal vision produces measurable dreams; vertical vision produces uncountable ones. Land can be paced out; stars mock arithmetic. And it was under the uncountable sky that Abraham “believed the Lord, and he credited it to him as righteousness” (15:6) — the great faith of history was born at a vision upgrade.

Some of us have been faithful with horizontal vision — plans, targets, five-year measures — and God is saying: come outside. Let Him show you a future too large for your instruments. An old man looked at his old body and believed for a nation, because his lenses had been changed under a night sky.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Are your current dreams countable? What would an "uncountable" version look like?

— What "tent" — what roofline of assumption — is God taking you outside of?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$God of Abraham, take me outside. Turn my eyes from the horizon to the heavens, and give me a promise too large to count — and faith to believe it. Amen.

_May God take you outside this week — and may you never fit back under the old roof._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 15:1–6; Romans 4:18–21$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:36', $dev$“Your servant has killed both the lion and the bear; this uncircumcised Philistine will be like one of them.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Where were David's lenses ground? Not in the valley of Elah — in the shepherd fields, where nobody was watching. Every private victory over lion and bear deposited a certainty: God delivers. By the day of Goliath, the boy was not being brave; he was reading history.

This is what your hidden season is actually manufacturing. The unseen faithfulness, the small deliverances, the prayers answered quietly — they are an optics laboratory, calibrating your vision for a public assignment you cannot yet imagine.

So keep records like David did. Write down every lion and bear — the fees paid at the deadline, the sickness healed, the door opened. A rehearsed testimony becomes a lens; the man who remembers rightly sees rightly. Your present obscurity is not a delay. It is where your Goliath-lenses are being made.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— List your lions and bears — the private deliverances you have witnessed.

— How does that list change the way today's challenge looks?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You for the laboratory of my hidden seasons. I will keep the records and rehearse the deliverances — grind my lenses for the valley ahead. Amen.

_May every remembered deliverance sharpen your sight for the next one._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$1 Samuel 17:32–37; Psalm 78:70–72$dev$),
  (7, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:26', $dev$“David asked… “Who is this uncircumcised Philistine that he should defy the armies of the living God?””$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$For forty days, an army looked at Goliath and saw the same thing: a giant too big to fight. David looked at the same giant and saw something else entirely: a target too big to miss — an affront to the living God, already as good as fallen.

Same valley. Same giant. Two lenses. Saul's army measured Goliath against themselves and despaired; David measured Goliath against God and volunteered. The measurement decided everything — who trembled, who ran forward, and whose story is told three thousand years later.

Your Goliath is real; new lenses do not deny giants, they re-measure them. So run today's exercise deliberately: take your giant and change the ruler. Not “how big is it next to me?” but “how big is it next to the God of my lions and bears?” Watch the giant shrink to hittable size.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Against what have you been measuring your giant — yourself, or your God?

— Re-measure it aloud: "Who is this ___ next to the living God?"$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Living God, I change rulers today. My giant is real — and small beside You. Give me David's eyes, David's run, and David's testimony. Amen.

_May every giant in your valley shrink to the size of a testimony._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$1 Samuel 17:41–50$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '2 Corinthians 9:8', $dev$“And God is able to bless you abundantly, so that in all things at all times, having all that you need, you will abound in every good work.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is a discovery that frees visionaries from panic: vision and provision go together — but our provision is never equal to our vision at the moment we receive it. God shows you a wall before He shows you the timber; that gap is not a mistake. It is the space where faith lives.

If full provision arrived with the vision, no trust would be required and no testimony would be produced. Instead, provision travels: it meets vision along the road of obedience — Nehemiah received letters and timber after he stood before the king; the widow's oil multiplied as she poured.

So do not audit a God-given vision by your current account balance; audit it by His word. Begin building at the size of today's supply, and watch supply enlarge at the pace of your obedience. The gap you fear is the very ground where God intends to prove Himself.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which vision have you shelved because provision wasn't visible on day one?

— What is the "size of today's supply" — and what can you build with it now?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Provider God, I stop demanding the timber before the obedience. I will build at today's size and trust provision to meet vision on the road. Amen.

_May provision keep meeting you on the road, exactly on time, all your life._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$2 Corinthians 9:8–11; 2 Kings 4:1–7$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Acts 2:17', $dev$““In the last days, God says, I will pour out my Spirit on all people. Your sons and daughters will prophesy, your young men will see visions, your old men will dream dreams.””$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Somewhere along the road, many people quietly bury their dreams — after the failure, the betrayal, the years of delay — and they call the burial “being realistic.” But hear the promise of the poured-out Spirit: visions for the young, dreams for the old. In God's economy, dreaming has no retirement age.

Abraham was seventy-five at his first promise and a hundred at its fulfillment. Moses' greatest chapter began at eighty. Heaven specializes in resurrections — and that includes buried dreams.

So conduct an exhumation today. What did you once see — before the disappointment reinterpreted it? Take it back to God honestly: some dreams He will resurrect as they were; some He will resurrect transformed, better fitted to your book. But let Him be the one to decide what stays buried. Realism that buries what God authored is not maturity. It is grief wearing a disguise.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What dream did you bury and label "being realistic"?

— Bring it to God today: resurrect, transform, or release — what is He saying?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Spirit of God, poured out on all flesh — pour out on me. Breathe on the buried dreams; resurrect what You authored, transform what You are redirecting, and give me courage to see again. Amen.

_May old dreams stir in their graves this week — and rise at His voice._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 2:14–21; Joel 2:25–28$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Habakkuk 2:2–3', $dev$“Then the Lord replied: “Write down the revelation and make it plain on tablets so that a herald may run with it. For the revelation awaits an appointed time… Though it linger, wait for it; it will certainly come.””$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Ten days of new lenses now come to a desk. God's instruction to Habakkuk is your commissioning: write it down. Unwritten vision evaporates; written vision recruits. Write it plainly — so plainly that a runner can carry it: your children, your team, your own tired self on a discouraging Tuesday.

Then receive the timing clause as a comfort, not a frustration: the vision awaits an appointed time; though it linger, it will certainly come. Between the writing and the arriving stands the season of faithful running — and you now have the lenses for it: eyes opened by Christ, heart enlightened, giants re-measured, provision trusted, dreams resurrected.

So write today — one page: what has God shown you in these ten days? Post it where your eyes will find it daily. What you see is what you become; from today, see it in writing.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Write the vision — one plain page. What did God show you across these ten days?

— Where will you post it, and who else should be able to "run" with it?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, I write what You have shown me, and I will run with patience toward the appointed time. Keep my lenses clean and my feet moving — it will certainly come. Amen.

_May the vision you write today outrun your lifetime and bless your children's children._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Habakkuk 2:1–3; Proverbs 4:25–27$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
