-- Reseed built-to-last with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'built-to-last');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Proverbs 13:4', 'The Bridge You Never Built'),
  (2, 'Luke 16:10', 'Motivation Is Weather. Discipline Is Climate.'),
  (3, 'Daniel 1:8', 'Daniel Purposed in His Heart'),
  (4, 'Daniel 6:10', 'Knees With a Schedule'),
  (5, '1 Corinthians 9:25', 'The Athlete’s Secret'),
  (6, 'Proverbs 24:30–31', 'The Field of Small Neglects'),
  (7, 'Proverbs 4:23', 'Guard Your Gates'),
  (8, 'Joshua 1:8', 'The Discipline of the Word'),
  (9, 'Proverbs 3:9', 'Disciplines Nobody Applauds'),
  (10, 'Hebrews 12:11', 'A Culture, Not an Event')
) AS v(n, ref, title) WHERE p.code = 'built-to-last';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'built-to-last'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Proverbs 13:4', $dev$“A sluggard’s appetite is never filled, but the desires of the diligent are fully satisfied.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Every January, gyms fill up and journals get bought. By March, both sit mostly empty. What died was never the dream — it was the bridge to the dream, a bridge nobody built.

Solomon is watching two people who want the same thing. Look closely at what the proverb does not say. It does not say the sluggard has no appetite; it says his appetite is never filled. He wants. He craves. He may want it more loudly than anyone. Desire is not the dividing line between people — everybody desires. The line runs somewhere else, and Solomon names it in one word: diligent. The desires of the diligent are fully satisfied, not because they wanted more, but because they built.

This is the whole secret Scripture keeps returning to. Grace supplies the power, but discipline positions you under the tap; "faith without works is dead" (James 2:17), and desire without diligence is just a wish wearing a costume. Two people can hear the same sermon, receive the same promise, and carry the same gifting, then arrive at two entirely different lives. The difference was never information — they both knew what to do. One built the bridge. The other stood on the near bank and admired the river.

So name the river today. There is something God has shown you that you keep looking at from the wrong side — a book unwritten, a body unhealed, a relationship unmended, a gift unpracticed. You have admired it long enough. Diligence does not mean crossing the whole river at once; it means laying one plank, then coming back tomorrow to lay another.

The dream will not carry you across. The bridge will.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What vision have you been admiring for years without building toward it?

— Where in your life is appetite pretending to be commitment?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, forgive me for mistaking desire for diligence. I have admired the river long enough. Show me the first plank of the bridge, and give me grace to lay it today, and grace to come back tomorrow.

_May you stop wishing at the water's edge, and start building the bridge God has already shown you._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 13:4; James 1:22–25$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Luke 16:10', $dev$“Whoever can be trusted with very little can also be trusted with much.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Motivation arrives like a warm front on the first of January and is gone by February. Have you noticed it never sends notice before it leaves?

That is because motivation is weather — real, beautiful, and completely unreliable. It visits and it departs, and it was never in charge of the harvest. Discipline is something else entirely: it is climate, the settled pattern that decides what can actually grow in a life. A palm tree does not grow because of one warm afternoon; it grows because of a climate. And here is why this matters spiritually — the enemy of your soul is not threatened by your resolutions. He has watched thousands of them die quietly of natural causes. He is threatened by your habits, the decisions that have finally stopped asking your feelings for permission.

Jesus builds His entire economy on exactly this. "Whoever can be trusted with very little can also be trusted with much" — faithfulness in the small thing is the qualifying exam for the large thing. Read it carefully: not brilliance in the very little, not passion in the very little, but faithfulness. Showing up when the weather is bad. The kingdom is not handed to the gifted; it is entrusted to the faithful, "for who has despised the day of small things?" (Zechariah 4:10).

So stop waiting to feel like it. The feeling is weather; it is not coming reliably and you cannot build on it. Instead, choose the smallest version of the discipline you are chasing — five minutes, one page, one honest conversation — and choose it permanently, on the good days and the grey ones alike. Start smaller than your ambition wants, but start in a way you can keep forever.

Weather decides your mood today. Climate decides your harvest.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Which resolution do you keep restarting — and what feeling does it always wait for?

— What is the smallest version of that discipline you could keep even on your worst day?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Lord, I resign from the weather of motivation and enrol in the climate of discipline. Teach me faithfulness in the very little, on the days I feel nothing at all, and trust me, in time, with the much.

_May your life be governed by climate, not weather — steady when your feelings are not._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 16:10–12; Zechariah 4:10$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Daniel 1:8', $dev$“But Daniel purposed in his heart that he would not defile himself.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Picture a teenager, taken captive, marched into a superpower engineered to erase him — new name, new language, new curriculum, new gods, and a royal buffet designed to make him forget the taste of home. Everything about Babylon was built to dissolve Daniel. And Scripture records his resistance in five quiet words.

He purposed in his heart. Notice where the decision happened — in the heart, and notice when — before the food ever arrived. Daniel did not stand at the king's table weighing his options while the aroma argued with his convictions. The battle was already over by the time the test showed up, because he had settled it in private, in advance. This is the hinge the whole chapter turns on: discipline that is negotiated in the moment of temptation almost always loses. The buffet is not the place to decide you are fasting.

The people Scripture holds up as those who become are not making a hundred fresh decisions a day. They make a few decisions once, deeply, and then spend years simply enforcing them. Daniel decided once as a youth and lived out that single settled choice for the next seventy years, through three empires. "I have hidden your word in my heart that I might not sin against you" (Psalm 119:11) — the heart is where obedience is either stored ahead of time or improvised too late.

So do the work tonight, in the quiet, before the noise finds you. What recurring temptation keeps catching you undecided, forcing you to re-fight the same battle every time it appears? Take it off the table now. Purpose it in your heart before the empire sets its table in front of you.

Decide once in private, and you will not have to decide again in the crowd.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Which recurring temptation finds you undecided every single time?

— What one decision could you make once — tonight — that would end a hundred daily battles?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$God of Daniel, I come to make my decisions in the quiet, before the noise arrives. Tonight I purpose in my heart what I will not do and who I will be. Hold me to it when the empire sets its table in front of me.

_May you settle in private the battles you have been losing in public._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 1:3–21$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Daniel 6:10', $dev$“Three times a day he got down on his knees and prayed, giving thanks to his God, just as he had done before.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$A death decree has just been signed. Lions are waiting. And the man in the crosshairs responds by doing exactly what he did last Tuesday. Read the last five words of the verse again: just as he had done before.

The lions' den did not find Daniel improvising a panicked, emergency altar. It found a man whose knees already had a schedule — three appointments a day, kept for decades, a prayer habit so deeply grooved that a royal threat could not reroute it. And this exposes something sobering about crisis: pressure does not build character, it reveals it. The storm does not teach you to pray; it shows the world whether you already do. Whatever you had been doing quietly, daily, in the ordinary weeks, is precisely what the crisis will find installed when it kicks the door in.

This is why the ancients prayed at fixed hours before there was any trouble in sight. "Evening and morning and at noon I will pray, and cry aloud, and He shall hear my voice" (Psalm 55:17). Your habits are quietly becoming your strength or your absence of it. In fact, your habits are prophecies — show me what you do every single day and I will show you what you are becoming, long before you arrive there.

So do not wait for a crisis to make you spiritual. The storm is a terrible time to learn to build; the materials get soaked and the hands are shaking. Give your knees a schedule now, in the calm — a time, a place, a rhythm you keep when nothing is on fire. Then when the den comes, and some kind of den always comes, it will find you already strong.

Build the altar in peacetime, so the war does not have to.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— If a crisis hit this week, what habits would it find already in place?

— What time and place will you give your knees, starting tomorrow?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, before the den, before the decree, before the crisis — establish my altar. Give my knees a schedule and my soul a rhythm that trouble cannot interrupt. Let the storm find me already kneeling.

_May the habits you build in the calm become the strength you stand on in the storm._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 6:1–23; Psalm 55:17$dev$),
  (5, 1, 'scripture', 'Today''s Reading', '1 Corinthians 9:25', $dev$“Everyone who competes in the games goes into strict training. They do it to get a crown that will not last; but we do it to get a crown that will last forever.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Paul is writing to Corinth, a city that hosted the games, and he points to the athletes everyone admired. Look, he says, at what people will suffer for a wreath of leaves that will be brown within a week.

Dawn training in the cold. Strict diets that refuse a hundred good things. Years of anonymous, unglamorous repetition for a few minutes of competition — all for a crown that withers. Then Paul turns the comparison and lets it cut: we run for a crown that lasts forever. If a man will discipline his whole body for a fading leaf, shall the eternal be pursued with less seriousness than the temporary? And then the apostle does something that should stop us cold — he gives his own testimony: "I discipline my body and keep it in subjection, lest... I myself should become disqualified" (1 Corinthians 9:27).

Sit with that. The greatest missionary in history, the man who wrote half the New Testament, did not trust his calling to exempt him from training. He knew that gifting is never a substitute for governance of the self. A powerful gift strapped onto an ungoverned life does not produce a great man; it produces a spectacular collapse. Your body — your appetites, your sleep, your comforts, your screens — is not your enemy. But it is a terrible master and an excellent servant, and every single day you decide which one it gets to be.

So look honestly at where your body is currently giving the orders. Then take back command, not with self-hatred but with training. "Present your bodies a living sacrifice" (Romans 12:1) — a servant of the call, not its master.

Discipline the servant, or be disqualified by the master.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Where does your body currently give the orders — sleep, food, comfort, screens?

— What would "strict training" look like for your eternal crown, this month?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Lord, I refuse to be disqualified by an ungoverned self. I present my body as a living sacrifice — a servant of the call, not its master. Train me like an athlete of the Kingdom, for a crown that will not fade.

_May your body become the disciplined servant of your calling, and never its master._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 9:24–27; Romans 12:1$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Proverbs 24:30–31', $dev$“I went past the field of a sluggard… thorns had come up everywhere, the ground was covered with weeds, and the stone wall was in ruins.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Nobody plants thorns. That is the first thing to see when you walk past this ruined field. No one decided to grow weeds; no one laid a plan for collapse.

Solomon takes us on a slow walk past a man's neglected property, and the scene is devastating — thorns everywhere, weeds carpeting the ground, the protective wall crumbled into rubble. But read what caused it, because there is no drama in the diagnosis. No rebellion, no scandal, no single great failure. Just "a little sleep, a little slumber, a little folding of the hands to rest" (Proverbs 24:33), repeated until the little became the landscape. This is the quiet law of ruin: failure needs no plan. It is simply the natural harvest of small neglects, compounding daily while you are not looking.

Here is why that is both a warning and a hope. The warning first: the wall around your marriage, your health, your walk with God is almost never demolished in a day. It is neglected — one skipped conversation, one skipped meal-choice, one skipped prayer at a time — until a stranger can walk straight through the gap where a wall used to be. Ruin rarely announces itself; "the little foxes... spoil the vines" (Song of Songs 2:15) long before you notice the harvest is gone.

But now the hope, and it runs on the very same mathematics: if small neglects compound into a ruined field, then small faithfulnesses compound into a flourishing one. The same law that wrecks a life can rebuild it. You do not need a dramatic, cinematic turnaround today. You need to walk to the wall and put one stone back — one call, one page, one prayer, one apology — and then come back tomorrow and set another.

Ruin is built little by little. So is restoration.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Which wall in your life has been quietly losing stones?

— What is one stone you can put back today — one call, one page, one prayer, one apology?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, open my eyes to the gaps in my walls before the thorns fill the field. I renounce the "little by little" of neglect, and I embrace the "little by little" of faithfulness. Show me the one stone to set back today.

_May the small faithfulnesses you begin today compound into a restored and flourishing field._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 24:30–34; Song of Songs 2:15$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Proverbs 4:23', $dev$“Above all else, guard your heart, for everything you do flows from it.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Every farmer knows a rule the rest of us forget: whatever feeds your field is farming your field. You may own the land, but you do not decide the crop — the seed does that, and the seed comes in through the gate.

Solomon says guard your heart above everything else, because everything you do flows from it. Your heart has gates — your eyes, your ears, the company you keep — and whatever passes through those gates daily is planting something in the soil, whether you approved it or not. Here is a truth that reframes almost every struggle: much of what we scold ourselves for as weakness of willpower is really carelessness at the gates. We lose the battle at the point of intake — the midnight scroll, the bitter conversation replayed, the voices we let live rent-free in our heads — and then we are baffled that we keep losing it at the point of action.

So discipline is not only about what you force yourself to do; it is at least as much about what you allow yourself to see and hear. What you focus on multiplies. "Finally, brothers, whatever is true, whatever is noble... think about such things" (Philippians 4:8) is not a suggestion for the sentimental; it is agricultural science for the soul. The content you consume, the people you platform in your life, the images you feed your imagination at night — these are seeds, and every seed produces after its kind. You will not out-discipline a diet of poison.

So post a gatekeeper. Become as deliberate about your inputs as you have been trying to be about your outputs — cut one corrupting intake this week and plant something clean in the space it leaves. Do that, and you will find your outputs quietly beginning to obey. "I will set no wicked thing before my eyes" (Psalm 101:3) was a king's strategy, not a saint's slogan.

Guard the gate, and you will not have to fight the harvest.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Which gate is least guarded in your life — eyes, ears, or company?

— What one input will you cut this week, and what will you plant in its place?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord, I station a watchman at the gates of my heart. Guard my eyes, my ears, and my companions. Let only what serves my becoming pass through — and where I have fed on poison, teach me to plant what is clean.

_May you guard your gates so faithfully that your harvest has no choice but to obey._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 4:20–27; Psalm 101:2–3$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Joshua 1:8', $dev$“Keep this Book of the Law always on your lips; meditate on it day and night… Then you will be prosperous and successful.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$God has just handed Joshua the largest assignment of his generation — succeed Moses, cross the Jordan, take the land. And for a task that enormous, Heaven gives him exactly one instruction. Not a battle plan. Not a strategy for alliances. One habit.

Meditate on this Word day and night, and then — only then — you will be prosperous and successful. Stop and feel how strange that is. God attached the words "prosperous and successful" to a reading habit. Not to talent, not to networking, not to raw effort, but to the daily, unhurried ingestion of Scripture. And notice the verb: not merely read, but meditate. Because meditation is to the mind what digestion is to the body. Reading simply passes the food across the plate; meditation absorbs it into the bloodstream where it can actually build muscle and bone.

This is why one person can read a whole chapter and close the book completely unchanged, while another carries a single verse through the day like a sweet in the mouth — turning it, tasting it, softening it — and is quietly transformed by nightfall. "Blessed is the man... whose delight is in the law of the Lord, and who meditates on it day and night. He is like a tree planted by streams of water" (Psalm 1:2–3). The tree does not strain to bear fruit; it is simply rooted where the water is, and fruit becomes inevitable.

So change how you come to the Word tomorrow. Read, then think; read, then ponder; squeeze the verse like juice from an orange until the flavour is in you and not just in front of you. Take one verse — just one — and carry it from morning to night. If you feed on the Word today, it will show tomorrow. And if you skip it today, that will show tomorrow too.

Get the Word off your plate and into your bloodstream, and your life will prosper from the inside out.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Is the Word currently on your plate or in your bloodstream?

— What single verse will you carry through tomorrow, from morning to night?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$God of Joshua, make Your Word my daily bread and my nightly meditation. Let it move from my eyes to my mouth to my bloodstream, until my life prospers quietly from the inside out. Root me by the stream and let the fruit come.

_May the Word move from your plate into your bloodstream, and rebuild you from the inside out._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Joshua 1:6–9; Psalm 1:1–3$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Proverbs 3:9', $dev$“Honor the Lord with your wealth, with the firstfruits of all your crops.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Some disciplines come with an audience. People see you rise before dawn, train hard, show up early — and something in us quietly enjoys being seen doing right. But the disciplines that shape a destiny most deeply are almost always the ones nobody applauds.

Giving when no one is watching. Resting in a culture that worships hustle. Staying honest when the shortcut is available, profitable, and completely undetectable. Consider giving first, because it is stranger than it looks. Giving is a discipline of the heart's grip — it deliberately pries your fingers off provision and refastens them to the Provider. The firstfruits principle was never about God needing your money; the God who owns the cattle on a thousand hills is not short. It is about God healing your trust, teaching your clenched hand to open before you have seen how the month will end.

Rest is a hidden discipline too, and a humbler one than it seems. The person who genuinely cannot stop is quietly confessing a belief that the world is held up by their effort. But even Jesus, with the whole world to save, said to His exhausted friends, "Come with Me by yourselves to a quiet place and get some rest" (Mark 6:31). If the Son of God scheduled rest, your refusal to is not devotion — it is pride wearing a work ethic. And hidden integrity, the honest ledger no auditor will ever check, is where your true character actually lives.

So practice one hidden discipline this week — give in secret, rest without apology, or keep a promise no one is tracking. Do it for an audience of One. "Your Father who sees in secret will Himself reward you openly" (Matthew 6:4).

Heaven applauds what nobody sees — so build the disciplines that only God can watch.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which hidden discipline is weakest in your life — giving, rest, or hidden integrity?

— What will you do this week in secret, for an audience of One?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, wean me off applause. Build in me the hidden disciplines — the open hand, the trusting rest, the honest ledger — and reward them not with attention, but with becoming who You made me to be.

_May the disciplines only God sees become the ones that shape you most._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 6:1–6; Mark 6:30–32$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Hebrews 12:11', $dev$“No discipline seems pleasant at the time, but painful. Later on, however, it produces a harvest of righteousness and peace for those who have been trained by it.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Babylon fell. Media rose and gave way to Persia. Kings were crowned and kings were buried — and through every regime change, one old man kept praying three times a day at the same window. Empires came and went. Daniel's discipline outlived all of them.

That is what you have been building for ten days. Not a burst of inspiration, not a heroic sprint, but a culture — a way of living repeated so often it quietly becomes your nature. And today's verse refuses to flatter you about the cost. Read it honestly: no discipline seems pleasant at the time, but painful. Scripture does not pretend the bridge builds itself or that the training feels good in the moment. But watch what the verse promises on the other side of the pain — a harvest of righteousness and peace. And notice the strict condition attached to that harvest: it comes "to those who have been trained by it." Not visited by it. Not impressed by it. Trained by it.

There is the whole difference. Some people are visited by discipline in bursts and wonder why the harvest never arrives; the harvest is not watching your intensity, it is watching your consistency. "Let us not grow weary in doing good, for in due season we will reap if we do not give up" (Galatians 6:9). Due season — not next week. The harvest of these ten days will not appear in ten days, and that is precisely the point.

So do not close this plan the way you close a book, satisfied and finished. Choose the two or three disciplines that must survive past today — the Word, prayer, your craft, your body, your giving — and keep them especially on the days you feel absolutely nothing. Invite someone to sharpen you, "as iron sharpens iron" (Proverbs 27:17), and keep training.

Let discipline stop being an event in your life and finally become a culture — and the harvest will testify that you did not quit.

This plan is drawn from The Power to Become by Moses Mwicigi, where discipline joins vision, identity and destiny in the full journey of becoming.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Which two disciplines from these ten days will become your permanent culture?

— Who will you invite to keep you accountable — iron sharpening iron?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Lord, let discipline stop being an event in my life and become a culture. Train me on the days I feel nothing, and in the season of harvest, let righteousness and peace testify that I did not quit.

_May the training of these ten days become a culture that outlasts every changing season of your life._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 12:7–13; Galatians 6:9$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
