-- Built to Last: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Vision without discipline is a wish. Between what God has shown you and what you actually become stands a bridge, and the name of that bridge is discipline. Grace supplies the power — but discipline positions you under the tap.

Notice what the proverb does not say. It does not say the sluggard has no appetite; his appetite is enormous. Desire is not the difference between people — everybody desires. Diligence is the difference. Two people can hear the same sermon, receive the same promise, carry the same gifting, and arrive at two different lives: one built the bridge, the other admired the river.

Today, name the river. What has God shown you that you keep looking at from the wrong bank?$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What vision have you been admiring for years without building toward it?

— Where in your life is appetite pretending to be commitment?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, forgive me for mistaking desire for diligence. I choose today to stop admiring the river. Show me the first plank of the bridge, and give me the grace to lay it. Amen.

_May you lay the first plank of the bridge today — and love the work._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 13:4; James 1:22–25$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Luke 16:10', $dev$“Whoever can be trusted with very little can also be trusted with much.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Motivation visits you on the first of January and is gone by February. It is weather — beautiful, unreliable, and never in charge of the harvest. Discipline is climate: the settled pattern that decides what can actually grow in your life.

This is why the enemy is not threatened by your resolutions; he has watched thousands of them die of natural causes. He is threatened by your habits — the decisions that have stopped asking your feelings for permission.

Jesus builds His economy on this principle: faithfulness in the very little is the qualifying exam for the much. Not brilliance in the very little. Not passion in the very little. Faithfulness — showing up when the weather is bad. Start smaller than you think you should, but start permanently.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Which resolution do you keep restarting — and what feeling does it always wait for?

— What is the smallest version of that discipline you could keep even on your worst day?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Lord, I resign from the weather of motivation and enrol in the climate of discipline. Teach me faithfulness in the very little, and trust me, in time, with the much. Amen.

_May faithfulness in the very little quietly qualify you for the much._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 16:10–12; Zechariah 4:10$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Daniel 1:8', $dev$“But Daniel purposed in his heart that he would not defile himself.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Daniel was a teenager, a captive, in a foreign empire designed to erase his identity — new name, new language, new food, new gods. And the Scripture records his secret in five words: he purposed in his heart.

Notice where the decision happened: in the heart, before the test. Discipline that is negotiated at the moment of temptation always loses; the buffet is not the place to decide you are fasting. Daniel decided once, in private, and then enforced that single decision daily for decades.

Psychologists call it pre-commitment; Scripture has taught it for millennia. The men and women who become do not make a hundred decisions a day — they make a few decisions once, and then keep them. What do you need to settle tonight, before the next test finds you undecided?$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Which recurring temptation finds you undecided every single time?

— What one decision could you make once — tonight — that would end a hundred daily battles?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$God of Daniel, I come to make decisions in the quiet, before the noise. Tonight I purpose in my heart. Hold me to it when the empire sets its table in front of me. Amen.

_May one decision made tonight end a hundred daily battles._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 1:3–21$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Daniel 6:10', $dev$“Three times a day he got down on his knees and prayed, giving thanks to his God, just as he had done before.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Read the last five words again: just as he had done before. The lions' den did not find Daniel improvising an emergency altar. It found a man whose knees had a schedule — a prayer habit so established that not even a death decree could interrupt it.

Here is the sobering truth about crisis: it does not build character; it reveals the habits you brought into it. The storm is a terrible time to learn to build. Whatever you do daily is quietly becoming your strength — or your absence of it.

Your habits are prophecies. Show me what you do every day and I will show you what you are becoming. Give your knees a schedule now, and the den will find you already strong.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— If a crisis hit this week, what habits would it find already in place?

— What time and place will you give your knees, starting tomorrow?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, before the den, before the decree, before the crisis — establish my altar. Give my knees a schedule and my soul a rhythm that trouble cannot interrupt. Amen.

_May your knees keep a schedule that no crisis can interrupt._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 6:1–23; Psalm 55:17$dev$),
  (5, 1, 'scripture', 'Today''s Reading', '1 Corinthians 9:25', $dev$“Everyone who competes in the games goes into strict training. They do it to get a crown that will not last; but we do it to get a crown that will last forever.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Paul wrote to a city that hosted the games, and he pointed at the athletes: look at what people will endure for a leaf crown that withers in a week. Dawn training. Strict diets. Years of obscurity for minutes of competition. Then he turned the comparison on us: we run for a crown that lasts forever — shall the eternal be pursued with less seriousness than the temporary?

Then the apostle gives his own testimony, and it should stop us: I discipline my body and bring it into subjection. The greatest missionary in history did not trust his calling to exempt him from training. Gifting is never a substitute for governance of the self.

Your body is not the enemy — but it is a terrible master and an excellent servant. Decide daily which one it will be.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Where does your body currently give the orders — sleep, food, comfort, screens?

— What would "strict training" look like for your eternal crown, this month?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Lord, I refuse to be disqualified by an ungoverned self. I present my body as a living sacrifice — a servant of the call, not its master. Train me like an athlete of the Kingdom. Amen.

_May you train this season for a crown that cannot wither._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 9:24–27; Romans 12:1$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Proverbs 24:30–31', $dev$“I went past the field of a sluggard… thorns had come up everywhere, the ground was covered with weeds, and the stone wall was in ruins.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Nobody plants thorns. Read that field carefully: the sluggard never decided to ruin it. No dramatic rebellion, no great collapse — just “a little sleep, a little slumber, a little folding of the hands,” repeated. Failure needs no plan; it is the natural harvest of small neglects, compounded daily.

This is both a warning and a hope. The warning: the wall around your marriage, your health, your walk with God is not usually demolished — it is neglected, one skipped day at a time, until a stranger walks through the gap. The hope: if small neglects compound, so do small faithfulnesses. The same mathematics that ruins a field can grow one.

You do not need a dramatic turnaround today. You need to repair one stone in the wall — and come back tomorrow.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Which wall in your life has been quietly losing stones?

— What is one stone you can put back today — one call, one page, one prayer, one apology?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, open my eyes to the gaps in my walls before the thorns fill the field. I renounce the "little by little" of neglect and I embrace the "little by little" of faithfulness. Amen.

_May every wall you repair stone by stone stand for generations._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 24:30–34; Song of Songs 2:15$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Proverbs 4:23', $dev$“Above all else, guard your heart, for everything you do flows from it.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Every farmer knows: whatever feeds your field is farming your field. Your mind has gates — your eyes, your ears, your company — and whatever passes through them daily is planting something. Much of what we call weakness of willpower is really carelessness at the gates: we lose the battle at the point of intake, then wonder why we lose it at the point of action.

Discipline, then, is not only about what you make yourself do; it is about what you let yourself see and hear. What you focus on multiplies. The news you consume, the voices you platform in your life, the content you scroll at midnight — these are seeds, and every seed produces after its kind.

Post a gatekeeper. Be as deliberate about your inputs as you have tried to be about your outputs, and the outputs will begin to obey.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Which gate is least guarded in your life — eyes, ears, or company?

— What one input will you cut this week, and what will you plant in its place?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord, I station a watchman at the gates of my heart. Guard my eyes, my ears and my companions. Let only what serves my becoming pass through — and let it multiply. Amen.

_May your gates admit only what your future will thank you for._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 4:20–27; Psalm 101:2–3$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Joshua 1:8', $dev$“Keep this Book of the Law always on your lips; meditate on it day and night… Then you will be prosperous and successful.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$God gave Joshua the largest assignment of his generation — and one instruction for succeeding at it. Not networking. Not talent. Meditation on the Word, day and night. Heaven attached “prosperous and successful” to a reading habit.

Meditation is to the mind what digestion is to the body. Reading passes food across the plate; meditation absorbs it into the bloodstream. This is why a man can read a whole chapter and remain unchanged, while another man carries one verse through his day like a sweet in his mouth — and is transformed. Read, think; read, ponder; squeeze the virtue of what you read like juice from an orange.

If you read today, it will show tomorrow. If you don't read today — that will also show tomorrow.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Is the Word currently on your plate or in your bloodstream?

— What single verse will you carry through tomorrow, from morning to night?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$God of Joshua, make Your Word my daily bread and my nightly meditation. Let it move from my eyes to my mouth to my bloodstream, until my life prospers from the inside out. Amen.

_May today’s verse still be sweet on your tongue at midnight._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Joshua 1:6–9; Psalm 1:1–3$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Proverbs 3:9', $dev$“Honor the Lord with your wealth, with the firstfruits of all your crops.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Some disciplines are visible — people see you rise early, train hard, show up. But the disciplines that shape a destiny most deeply are the ones nobody applauds: giving when no one is watching, resting when hustle is idolized, staying honest when a shortcut is available and profitable.

Giving is a discipline of the heart's grip — it pries your fingers off provision and fixes them on the Provider. The firstfruits principle is not God needing your money; it is God healing your trust. Rest is a discipline of humility: the man who cannot stop is quietly confessing that he believes the world is held up by his effort. Even Jesus said, “Come with me by yourselves to a quiet place and get some rest.”

Practice one hidden discipline this week. Heaven applauds what nobody sees — and “your Father, who sees what is done in secret, will reward you.”$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which hidden discipline is weakest in your life — giving, rest, or hidden integrity?

— What will you do this week in secret, for an audience of One?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, wean me off applause. Build in me the hidden disciplines — the open hand, the trusting rest, the honest ledger — and reward them not with attention, but with becoming. Amen.

_May heaven’s reward find what you practiced in secret._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 6:1–6; Mark 6:30–32$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Hebrews 12:11', $dev$“No discipline seems pleasant at the time, but painful. Later on, however, it produces a harvest of righteousness and peace for those who have been trained by it.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Daniel served at the top of three empires — Babylon fell, Media rose, Persia followed, and Daniel remained. Regimes change; discipline survives regimes. That is what you have been building for ten days: not a burst of effort, but a culture — a way of living repeated until it becomes a nature.

Read today's verse honestly: discipline is painful, and Scripture does not pretend otherwise. But the verse contains a harvest, and the harvest has a condition — it comes “to those who have been trained by it.” Not visited by it. Trained by it.

So do not close this plan the way you close a book. Choose your daily disciplines — the Word, prayer, your craft, your body, your giving — and keep them on the days you feel nothing. The harvest is not watching your feelings. It is watching your training.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Which two disciplines from these ten days will become your permanent culture?

— Who will you invite to keep you accountable — iron sharpening iron?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Lord, let discipline stop being an event in my life and become a culture. Train me. And in the season of harvest, let righteousness and peace testify that I did not quit. Amen.

_May discipline become a culture in you — and a harvest after you._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 12:7–13; Galatians 6:9$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
