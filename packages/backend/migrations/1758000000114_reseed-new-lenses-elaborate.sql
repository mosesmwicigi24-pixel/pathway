-- Reseed new-lenses with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Two disciples walked home from Jerusalem the day the world was supposed to have ended. Their teacher was dead, their hope was buried, and their eyes — working perfectly — could see only a finished story. Then a stranger fell in step beside them, opened the Scriptures, broke the bread, and suddenly “their eyes were opened and they recognized him.” Nothing about the facts had changed. Everything about their seeing had.

That is where this plan must begin: not with a technique, but with a Person. Everywhere Jesus went, He opened eyes. He called blind Bartimaeus off the Jericho roadside and gave him sight. He made mud for the man born blind. And on Emmaus evening He proved that the deepest blindness is not in the retina but in the heart — discouragement had shown these two a dead teacher and a closed grave; opened eyes showed them a risen Lord and a story just beginning. Same road, same men, same events — new lenses, and hearts that suddenly burned.

Here is the core truth to carry through these ten days: every upgrade of vision flows from Him. You cannot argue yourself into new sight, and you cannot manufacture it by trying harder to be positive. Vision is given. That is why the Optician is not a program but a Savior, and why the first move is never analysis but prayer. Bartimaeus modeled the words Jesus loved to hear: “Rabbi, I want to see” (Mark 10:51) — and Jesus answered on the spot.

So bring Him the place where your story looks over. The relationship you have written off, the door you assume is permanently shut, the version of your future that plays like a rerun of your worst season. Do not first ask Him to change the circumstance; ask Him to open your eyes to what is already true about it in heaven. Say it plainly today, out loud if you can: Lord, I want to see.

He has never once refused that prayer — and He will not begin with you.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Where might your story look "finished" only because of the lenses you're wearing?

— Pray Bartimaeus' prayer over one specific area today: "Lord, I want to see."$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, Opener of eyes — my sight is Yours to upgrade. Where discouragement has written "the end" across my story, walk beside me and open my eyes to the risen truth. I am not asking first for new circumstances; I am asking for new eyes. Rabbi, I want to see. Amen.

_May your heart burn within you as He opens your eyes on the road this week._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 24:13–35; Mark 10:46–52$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Proverbs 29:18', $dev$“Where there is no vision, the people perish: but he that keepeth the law, happy is he.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Before any action ever leaves your hands, it passes through a room you rarely visit on purpose — the picture room of your inner vision. And it is the picture, not the circumstance, that gives the orders. Everything you do is the interpretation of what you see from the inside.

This is why the enemy fights your imagination long before he touches your circumstances. If he can corrupt the picture, he can cancel the performance without a single visible battle. A man who has quietly rehearsed his own failure walks toward it on schedule; he does not need an obstacle — he has already seen the ending. The mind moves toward the picture it keeps returning to, for good or for ruin.

Scripture ties this to survival itself: “where there is no vision, the people perish.” The word carries the sense of unravelling — people cast off restraint, drift, scatter, come apart. Notice the second half of the proverb, too: the one who keeps the law is happy. Vision and obedience are partners. Vision gives discipline its reason, and obedience gives vision its road. Where the picture is clear, the sacrifice makes sense; where the picture is blank, even good rules feel like a cage.

So take an honest inventory today. When you close your eyes and picture your future — your marriage, your work, your walk with God five years from now — what actually plays? Not what you would say in a testimony service, but the reel that runs unbidden at 2 a.m. That reel, left unedited, is your current trajectory. It is quietly writing your tomorrows in advance.

The good news is that the film is not locked. The Optician who opened blind eyes can re-cut what fear has been screening. What you see is what you become — so today, bring Him the reel.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Describe honestly the "reel" that plays when you picture your future.

— Which single scene needs the Optician's edit first — and why that one?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I open the picture room to You. Edit the reel — remove every scene that fear filmed and doubt directed, and load the pictures You wrote of me before I was born. Let what I see agree with what You have said. Amen.

_May the pictures you live from be replaced by the pictures He wrote you from._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 29:18; Habakkuk 2:2–3$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:18', $dev$“I pray that the eyes of your heart may be enlightened in order that you may know the hope to which he has called you…”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$There are two ways to look at your life, and they do not use the same organ. Sight is a function of the eyes; vision is a function of the heart. Sight reports what is. Vision perceives what God intends.

Watch the difference all through Scripture. Sight saw a shepherd boy smelling of sheep; vision saw a king. Sight saw rough fishermen mending nets; vision saw apostles who would turn the world upside down. Sight saw a barren old couple; vision saw more descendants than the stars. Sight reads your present paragraph; vision reads your whole book. The two are looking at the identical scene and coming home with different reports.

This is precisely why Paul prays not for changed circumstances first, but for changed eyes: “that the eyes of your heart may be enlightened.” He assumes an inner set of eyes — eyes that can be opened or dimmed, trained or neglected — and he asks God to switch on the light behind them so his readers can finally know “the hope of his calling,” the riches of the inheritance, the greatness of the power at work in them. Notice the order. Enlightenment comes before information; you cannot know these things until you can see them.

And this inner sight sets you free from the tyranny of the visible. The present is never enough for a heart that has seen what God has said. That freedom is intensely practical: the person who has genuinely seen where the road ends saves differently, studies differently, forgives more quickly, prays with more nerve — because they are living from a destination their neighbors cannot yet see.

So ask for the Ephesians enlightenment today. Not new circumstances first — new eyes first. Let the eyes of your heart out-see the eyes in your head.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— What has "sight" been reporting that "vision" would read differently?

— What do you sense God intends that your physical eyes cannot yet confirm?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, enlighten the eyes of my heart. Where sight keeps reporting limits, let vision read Your intentions — the hope of Your calling, the riches of my inheritance, the power at work in me. Turn on the light behind my inner eyes. Amen.

_May the eyes of your heart out-see the eyes in your head from today._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 1:15–21; 2 Kings 6:15–17$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Genesis 13:14–15', $dev$“The Lord said to Abram after Lot had parted from him, “Look around from where you are, to the north and south, to the east and west. All the land that you see I will give to you.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Read the timing before you read the promise: “after Lot had parted from him.” God waited to enlarge Abraham's vision until a certain arrangement had ended. Lot was not an enemy — he was family, and there had been real affection there — but as long as Lot and his herds shared the horizon, Abraham's seeing was crowded and capped. The moment the separation was complete, God said, in effect: now — look.

Some vision waits for a parting. Not always from people we resent; often from dependencies, partnerships, and comfortable arrangements that quietly narrowed what we allowed ourselves to see. There are futures we cannot survey while we are still leaning on the thing God is asking us to release.

Then notice the astonishing boundary God draws around the gift: “all the land that you see I will give to you.” He tied the inheritance to the eyesight. The giving was measured out to the exact size of the looking. What Abraham refused to survey, he simply would not receive — not because God was stingy, but because the promise was shaped to fit the vision. Under-look, and you under-inherit.

And mark the starting point most of all: “from where you are.” God did not tell Abraham to relocate to a better vantage. He said, from this dusty spot, lift your eyes and turn all the way around — north, south, east, west, deliberately, in every direction. Vision does not require a better location. It requires lifted eyes at the one you already occupy.

So stand exactly where life has you today — the same job, the same town, the same unglamorous season — and look again, on purpose, in every direction. Ask God to show you the inheritance that has been standing in plain sight all along, simply waiting for a looker.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Has any "Lot" — an arrangement, a dependency, a comfort — been quietly capping your vision?

— Look around "from where you are": what is God showing you that you never bothered to survey?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, from where I stand — not where I wish I stood — I lift my eyes north, south, east and west. Show me the inheritance that has been waiting for a looker, and give me the courage to part with whatever has been capping my sight. Amen.

_May your inheritance grow to the exact size of your lifted eyes._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 13:5–18$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Genesis 15:5', $dev$“He took him outside and said, “Look up at the sky and count the stars — if indeed you can count them.” Then he said to him, “So shall your offspring be.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Abraham's first upgrade had been horizontal — land he could pace out, boundaries he could survey, a promise you could, in principle, measure. His second upgrade was of an entirely different order. God took him outside — out of his tent, out from under his own roofline — and turned his face from the horizon to the heavens: “count the stars, if indeed you can.”

There is a lesson hidden in that change of direction. Horizontal vision produces measurable dreams; vertical vision produces uncountable ones. Land can be walked off in a day. Stars mock arithmetic. God was not merely giving Abraham a bigger version of the same picture — He was pulling him out from under the ceiling of what could be counted at all.

And notice where the greatest faith in Scripture was born. It was under that uncountable sky that “Abram believed the Lord, and he credited it to him as righteousness” (Genesis 15:6) — the verse Paul would build the whole doctrine of faith upon. The father of all who believe received his faith at a vision upgrade, staring up at a promise too vast to tally. Later Scripture is blunt about the circumstances: he was as good as dead, his body long past fathering, Sarah's womb closed — “yet he did not waver through unbelief” (Romans 4:19–20). Why not? Because his lenses had been changed under a night sky, and once you have seen the stars you cannot un-see them.

Some of us have been faithful with horizontal vision for years — plans, targets, tidy five-year measures — and God is quietly saying: come outside. Step out from under the roof of what you can calculate. Let Him show you a future too large for your instruments.

An old man looked at his old body and believed for a nation. Let Him take you outside tonight.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Are your current dreams countable? What would an "uncountable" version of them look like?

— What "tent" — what roofline of assumption — is God taking you outside of?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$God of Abraham, take me outside. Turn my eyes from the horizon to the heavens, and give me a promise too large to count — then give me the faith to believe it against every reasonable objection my body and history can raise. Amen.

_May God take you outside this week — and may you never fit back under the old roof._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 15:1–6; Romans 4:18–21$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:36', $dev$“Your servant has killed both the lion and the bear; this uncircumcised Philistine will be like one of them.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Where, exactly, were David's lenses ground? Not in the valley of Elah, with an army watching and a nation's fate hanging on the outcome. They were ground far earlier, in the shepherd fields where no one was watching at all — in the private, unpaid, unglamorous work of keeping his father's sheep.

Every time a lion or a bear came for the flock, and God gave the boy the victory, something invisible was deposited: a certainty. God delivers. By the day of Goliath, David was not summoning courage from nowhere; he was simply reading his own history aloud. “The Lord who delivered me from the paw of the lion and the paw of the bear will deliver me from the hand of this Philistine” (17:37). To the terrified army it sounded like bravado. To David it was just arithmetic.

This is what your hidden season is actually manufacturing, though it rarely feels like it. The unseen faithfulness, the small deliverances no one applauded, the prayers answered so quietly you almost missed them — they are an optics laboratory, patiently calibrating your vision for a public assignment you cannot yet imagine. Obscurity is not the opposite of destiny. It is often destiny's workshop.

So learn David's habit: keep records. Write down every lion and every bear — the rent that came at the deadline, the diagnosis that reversed, the door that opened when every other one had shut, the provision that arrived from nowhere. Do not trust your memory to hold them; fear has a way of editing them out. A rehearsed testimony becomes a lens, and the person who remembers rightly sees rightly. When the next giant appears, you will not be guessing. You will be reading.

Your present obscurity is not a delay in your story. It is where your Goliath-lenses are being made.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— List your lions and bears — the private, unapplauded deliverances you have actually witnessed.

— How does that list change the way today's challenge looks to you?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You for the laboratory of my hidden seasons. I will keep the records and rehearse the deliverances instead of forgetting them. Grind my lenses in the quiet fields now, for the valley I cannot yet see ahead. Amen.

_May every remembered deliverance sharpen your sight for the next one._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$1 Samuel 17:32–37; Psalm 78:70–72$dev$),
  (7, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:26', $dev$“David asked… “Who is this uncircumcised Philistine that he should defy the armies of the living God?”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$For forty days the same giant stood in the same valley shouting the same threats, and for forty days an entire army looked at him and saw one thing: too big to fight. Then a shepherd boy arrived with lunch for his brothers, looked at the identical Goliath, and saw something no soldier had seen — a target too big to miss, an insult to the living God already as good as fallen.

Same valley. Same giant. Two completely different lenses. The difference was not courage; it was measurement. Saul's army measured Goliath against themselves — his height against their height, his spear against their spears — and the math produced despair. David measured Goliath against God — this uncircumcised Philistine against the armies of the living God — and the math produced a volunteer. The ruler each man used decided everything: who trembled and who ran forward, who is forgotten and whose story is still being told three thousand years later.

Understand clearly what new lenses do and do not do. They do not pretend the giant is small. Goliath really was over nine feet of armed menace; David never denied it. New lenses do not deny giants — they re-measure them. Faith is not blindness to the problem; it is accurate sight of the problem's true size relative to God.

So run today's exercise on purpose. Take your giant — the debt, the diagnosis, the impossible relationship, the closed door — and deliberately change the ruler. Stop asking, “How big is this next to me, next to my strength, my savings, my track record?” Ask instead, “How big is this next to the God who handled my lions and bears?” Say it out loud, in David's very words: “Who is this ___ that he should defy the armies of the living God?”

Watch what happens to the giant the instant you change the ruler. It shrinks to hittable size.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Against what have you been measuring your giant — yourself, or your God?

— Re-measure it aloud right now: "Who is this ___ next to the living God?"$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Living God, I change rulers today. My giant is real — I will not pretend otherwise — and it is small beside You. Give me David's eyes to see it rightly, David's run to face it, and David's testimony on the other side. Amen.

_May every giant in your valley shrink to the size of a testimony._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$1 Samuel 17:41–50$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '2 Corinthians 9:8', $dev$“And God is able to bless you abundantly, so that in all things at all times, having all that you need, you will abound in every good work.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is a discovery that frees visionaries from panic: vision and provision belong together — but the provision is almost never equal to the vision at the moment you receive it. God shows you the whole wall before He shows you a single plank of timber. That gap between what you have seen and what you currently hold is not a mistake, and it is not a sign that you heard wrong.

The gap is the space where faith lives. If full provision arrived neatly bundled with the vision, no trust would be required and no testimony would ever be produced. You would simply be executing a delivery, not walking with God. So He builds the gap in on purpose, because He is after more than a finished project — He is after a person who has learned to lean on Him.

And provision, it turns out, travels. It does not sit waiting at the starting line; it meets vision along the road of obedience. Nehemiah did not receive the king's letters and the timber for the gates until after he had risked standing before the king with the request. The widow's little jar of oil did not multiply in the cupboard; it multiplied as she poured, vessel after vessel, in the very act of obeying (2 Kings 4:1–7). Movement came first; supply followed the movement.

So stop auditing a God-given vision by your current account balance. Audit it by His word instead. Do not wait for the whole budget before you take the first obedient step. Begin building at the size of today's supply — the little you can already see, the plank you already hold — and watch the supply enlarge at the pace of your obedience.

The gap you have been afraid of is the very ground on which God intends to prove Himself to you.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which vision have you shelved because the provision wasn't visible on day one?

— What is the "size of today's supply" — and what can you actually build with it now?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Provider God, I stop demanding all the timber before I take the first step of obedience. I will build at today's size, with today's supply, and trust You to meet vision with provision on the road. The gap is where I will watch You work. Amen.

_May provision keep meeting you on the road, exactly on time, all your life._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$2 Corinthians 9:8–11; 2 Kings 4:1–7$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Acts 2:17', $dev$“In the last days, God says, I will pour out my Spirit on all people. Your sons and daughters will prophesy, your young men will see visions, your old men will dream dreams.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Somewhere on the road, quietly and without ceremony, a great many people bury their dreams. It usually happens after a specific wound — the failure that embarrassed them, the betrayal that cost them, the delay that stretched on so long that hope felt foolish. And then, to make peace with the loss, they give the burial a respectable name. They call it "being realistic."

But listen to what the Spirit says He does when He is poured out: visions for the young, dreams for the old — sons, daughters, young men, old men, servants, all of them seeing again. In God's economy, dreaming has no retirement age. He deliberately names the old alongside the young, as if to close the exit that disappointment loves to use.

The evidence backs the promise. Abraham was seventy-five at his first promise and a hundred at its fulfillment. Moses' greatest chapter did not begin until he was eighty, long after he had written himself off in a desert. Heaven specializes in resurrections — and that specialty is not limited to bodies in tombs. It extends to dreams in graves.

So conduct an honest exhumation today. What did you once see for your life — before the disappointment reinterpreted it and taught you to expect less? Do not be embarrassed by it. Take it back to God plainly and lay it in His hands. Some of what you buried He will raise exactly as it was, its time simply not yet arrived. Some He will raise transformed — better fitted to the book He is actually writing than the version you first imagined. But let Him be the one to decide what stays in the ground; that verdict was never yours to give.

Realism that buries what God authored is not maturity. It is grief wearing a disguise. Dare to dream again.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What dream did you bury and quietly relabel "being realistic"?

— Bring it to God today: resurrect, transform, or release — what is He actually saying?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Spirit of God, poured out on all flesh — pour out on me. Breathe on the dreams I buried and called realistic. Resurrect what You authored, transform what You are redirecting, and give me the courage to see again without flinching from the memory of the disappointment. Amen.

_May old dreams stir in their graves this week — and rise at His voice._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 2:14–21; Joel 2:25–28$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Habakkuk 2:2–3', $dev$“Then the Lord replied: “Write down the revelation and make it plain on tablets so that a herald may run with it. For the revelation awaits an appointed time… Though it linger, wait for it; it will certainly come.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Ten days of new lenses now come to a desk. Habakkuk had cried out to God for understanding, and when the answer came, God's very first instruction was not "act" but "write": write down the revelation, make it plain on tablets, so that a herald may run with it. Take that as your own commissioning today.

Understand why the writing matters. Unwritten vision evaporates. It feels vivid on the mountaintop and fades by the following Tuesday, until you cannot honestly recall what you were once so sure of. Written vision does the opposite — it recruits. Made plain enough, it can be picked up and carried by others: your children, your team, your spouse, and, not least, your own tired self on a discouraging day when the feeling has drained out and only the ink remains. Habakkuk was told to write it so plainly that someone could read it at a run.

Then receive the timing clause as a comfort rather than a frustration: “the revelation awaits an appointed time… though it linger, wait for it; it will certainly come.” Between the writing and the arriving stretches a season of faithful running — and you are no longer running blind. You now have the lenses these ten days have fitted: eyes opened by Christ, a heart enlightened, imagination re-filmed, land surveyed and stars counted, hidden seasons honored, giants re-measured, provision trusted on the road, and buried dreams called back to life.

So do the one concrete thing this plan has been building toward. Write it today — one plain page: what has God shown you across these ten days? Not vague good intentions, but the actual picture He has given you. Then post it where your eyes will find it daily, and start running toward the appointed time with patience.

What you see is what you become. From today, see it in writing — and run.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Write the vision — one plain page. What did God show you across these ten days?

— Where will you post it, and who else should be able to pick it up and "run" with it?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, I write down what You have shown me, and I will run with patience toward the appointed time. Keep my lenses clean and my feet moving on the days the vision seems to linger. You have said it will certainly come — so I will not give up before it does. Amen.

_May the vision you write today outrun your lifetime and bless your children's children._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Habakkuk 2:1–3; Proverbs 4:25–27$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
