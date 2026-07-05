-- Change to Become: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'change-to-become');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'John 12:24', 'The Seed Must Break Open'),
  (2, 'Matthew 4:17', 'Change Begins With a Changed Mind'),
  (3, 'Numbers 13:30', 'The Grasshopper Cure'),
  (4, 'Daniel 1:8', 'Habits: Decisions That Stopped Asking Permission'),
  (5, 'Galatians 6:7, 9', 'Sow a Habit, Reap a Destiny'),
  (6, 'Proverbs 22:29', 'Character: What Keeps You in the Rooms Your Gift Opens'),
  (7, 'Genesis 12:1', 'When God Says Move'),
  (8, '1 Corinthians 15:33; Proverbs 13:20', 'Guard Your Company'),
  (9, 'Philippians 1:6', 'The God of Process'),
  (10, 'Matthew 5:14', 'Become the Change Others Need')
) AS v(n, ref, title) WHERE p.code = 'change-to-become';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'change-to-become'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'John 12:24', $dev$“Very truly I tell you, unless a kernel of wheat falls to the ground and dies, it remains only a single seed. But if it dies, it produces many seeds.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Jesus spoke today’s verse about Himself — His death and the harvest of His resurrection. It is the deepest pattern in the universe: the way to more is through the breaking open of what is.

And because you are in Christ, the pattern is now yours: “If anyone is in Christ, the new creation has come: the old has gone, the new is here!” (2 Corinthians 5:17). The power to change is not your willpower straining against your history; it is His death-and-resurrection life working in you.

Many people want the harvest while keeping the seed-coat intact — new results, old self. It cannot be done. So begin this plan with the seed’s surrender: name the old form you have been protecting, and give God permission to break it open. Everything green starts there.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What “seed-coat” — an old identity, comfort, or pattern — have you been protecting?

— What harvest might be waiting on the other side of letting it break?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You fell into the ground and rose a harvest. Work Your pattern in me: I release the old form. Break it open gently, and bring the many seeds. Amen.

_May everything you surrender this week come back as harvest._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$John 12:23–26; 2 Corinthians 5:17$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Matthew 4:17', $dev$“From that time on Jesus began to preach, “Repent, for the kingdom of heaven has come near.””$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$The first word of Jesus’ public preaching was “Repent” — in the Greek, metanoia: change your mind. Before heaven changes a man’s circumstances, it calls for a change of mind, because a man always lives at the level of his thinking.

This ordering saves you years. Most of us attack our behaviors directly — the spending, the temper, the procrastination — and lose, because behaviors are fruits and minds are roots. Cut a fruit and it regrows; change a root and the whole tree turns.

So ask of the pattern you brought to this plan: what belief keeps it alive? I need this to cope. I will always be like this. This is who we are in our family. Change the sentence underneath, and the pattern above it begins to starve.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What belief sits at the root of the pattern you want broken?

— What is God’s replacement sentence for that root?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I bring You roots, not just fruits. Change my mind where the pattern feeds, and let the tree of my behavior turn from its base. Amen.

_May the root change quietly this week — and the branches loudly next season._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 4:17; Acts 3:19$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Numbers 13:30', $dev$“But Caleb… said, “We should go up and take possession of the land, for we can certainly do it.””$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Ten spies said, “We seemed like grasshoppers in our own eyes.” The defeat happened inside them before any battle was fought — and their inner measurement became a forty-year reality for a whole nation.

Caleb saw the same giants with a different mind, and God’s commendation of him is the cure written out: “because my servant Caleb has a different spirit and follows me wholeheartedly, I will bring him into the land” (Numbers 14:24). A different spirit. Wholehearted following. Entrance.

Changing to become requires this exchange of measurements. The question is never first “how big is the obstacle?” but “how big is my God — and what has He said?” Practice Caleb’s arithmetic on your current giant today: say aloud, over the specific thing, “We can certainly do it — for the Lord is with us.”$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has grasshopper arithmetic been deciding your attempts?

— Apply Caleb’s arithmetic to it — what changes?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, give me the different spirit of Caleb. I trade my measurements for Yours, and I will follow You wholeheartedly into the land You have promised. Amen.

_May a different spirit carry you where old arithmetic never could._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Numbers 13:26–14:9, 24$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Daniel 1:8', $dev$“But Daniel resolved not to defile himself…”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$A habit is a decision that has stopped asking for permission. That is its power — for you or against you. The enemy is rarely threatened by your resolutions; he has watched thousands die by February. He is threatened by your habits: the automatic behaviors that no longer consult your feelings.

Daniel shows the mechanics of holy habit: he resolved — once, in his heart, before the test — and then enforced one decision daily for decades. By the time crisis came, his knees had a schedule that a king’s decree could not interrupt (Daniel 6:10).

So change the pattern at the level where it lives: pick the single small habit that most serves your becoming — the five a.m. prayer, the daily page, the walk, the tithe — decide it once, tonight, and let tomorrow simply obey yesterday’s decision.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Which single habit, kept for a year, would most change your becoming?

— Decide it once, tonight: when, where, how small will it start?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$God of Daniel, I make the decision in the quiet, before the noise. One holy habit, decided once, kept daily. Hold me to it until it holds me. Amen.

_May one small habit begun this week still be blessing you in ten years._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 1:8–16; 6:10$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Galatians 6:7, 9', $dev$“Do not be deceived: God cannot be mocked. A man reaps what he sows. …Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$There is an old chain worth engraving on a doorpost: sow a thought, reap an action; sow an action, reap a habit; sow a habit, reap a character; sow a character, reap a destiny. Nothing about your life is random — it is agricultural.

This law is your friend, not your judge. It means no faithful small thing is wasted: every hidden discipline, every kind word, every resisted temptation is seed in the ground, and “at the proper time we will reap — if we do not give up.”

It also means audits are kind: look at any harvest in your life you dislike, trace it back down the chain, and you will find the seed — changeable, this very week. Your destiny is being decided in your ordinary Tuesdays. Sow them deliberately.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Trace one unwanted harvest down the chain: what seed is at the bottom?

— What seed will you begin sowing on ordinary Tuesdays?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You for a universe where sowing is never wasted. I take up my seed bag with joy — and I will not grow weary before the proper time. Amen.

_May your ordinary Tuesdays quietly assemble an extraordinary destiny._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Galatians 6:7–10; Hosea 10:12$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Proverbs 22:29', $dev$“Do you see someone skilled in their work? They will serve before kings…”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Your gift will open doors for you — but only your character will keep you in the rooms your gift opens. Many have been promoted by talent and demoted by character in the same year; the gift got them the platform, and the unchanged self broke it.

Joseph is the great study: the gift of dreams took him from prison to palace in a single day, but it was character — tested for years in Potiphar’s house and the dungeon — that kept him there for the rest of his life. “The word of the Lord tested him” (Psalm 105:19).

This reframes your waiting seasons entirely: the delay is not God wasting your time; it is God building the pillars that will carry the weight of your becoming. Cooperate with the construction — integrity when unseen, faithfulness when unthanked, purity when unwatched. The room your gift will open is already scheduled. Be the person who can stay in it.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Where is character currently being built in you through testing?

— Which trait — if unchanged — could break the platform your gift is building?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, build in me pillars before You build me platforms. Test me kindly, shape me thoroughly, and make me a man who can stay in the rooms You open. Amen.

_May your character grow one size larger than every room your gift will open._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 39–41; Psalm 105:17–22$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Genesis 12:1', $dev$“The Lord had said to Abram, “Go from your country, your people and your father’s household to the land I will show you.””$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$God’s first instruction to the father of faith was environmental: go from. The promise was attached to a relocation. Some becomings simply cannot happen at the old address — not because God is limited, but because you are formed by what surrounds you.

Seeds do not negotiate with soil; they respond to it. The same seed flourishes in one field and dies in another. Environments water or wither what is planted in you — the voices you sit under, the rooms you frequent, the atmosphere of your daily hours.

Not everyone is called to move cities; everyone is called to audit environments. Is there a place, a screen, a circle where your worst self grows effortlessly? And is there a fellowship, a mentor’s shadow, a table where your best self comes alive? Have the courage to leave the one and plant yourself in the other. Obedient feet unlock promised lands.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— In which environment does your worst self grow effortlessly?

— Where does your best self come alive — and how will you be there more?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father of Abraham, I hold my environments with open hands. Say “go from” where You must, and “go to” where You will — my feet are Yours. Amen.

_May your feet find the soil where everything God planted in you flourishes._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 12:1–4; Psalm 1:1$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '1 Corinthians 15:33; Proverbs 13:20', $dev$“Do not be misled: “Bad company corrupts good character.” … Walk with the wise and become wise, for a companion of fools suffers harm.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$The most powerful environment is not a place — it is people. You are being shaped daily by your closest voices: their expectations calibrate yours, their habits normalize themselves in you, their faith or fear is contagious.

Scripture is tender but unbending here: bad company corrupts good character — the verb is present tense and patient; it corrupts slowly, comfortably, like water shaping stone. And the reverse is equally sure: walk with the wise and you become wise. Becoming is partly a matter of walking partners.

Elisha left oxen to walk in Elijah’s shadow and inherited a double portion. Choose like that: identify the people whose walk with God you would gladly catch — and get near them. And where a friendship consistently farms your worst self, love faithfully, but reposition lovingly. Your destiny keeps company carefully.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which voices are currently calibrating you — and toward what?

— Whose shadow should you deliberately walk in this season?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, order my companionships. Give me the humility to walk in wise shadows, the love to bless every person, and the wisdom to guard my inner circle. Amen.

_May every walking partner God assigns you leave you closer to Him._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 13:20; 2 Kings 2:1–14$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Philippians 1:6', $dev$“Being confident of this, that he who began a good work in you will carry it on to completion until the day of Christ Jesus.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Real change is a process, and processes have unglamorous middles. There will be days you feel powerfully new and days the old pattern knocks like it still owns a key. Do not panic at the knocking — hearing the knock is not the same as opening the door.

Take today’s verse as your covenant of process: He who began is committed to completing. Your transformation has a Guarantor, and He does not abandon sites half-built. When you stumble, the family rule stands: confess quickly, receive mercy quickly, resume quickly (1 John 1:9). Shame delays change; grace accelerates it.

Measure yourself by trajectory, not by single days. The seed does not check itself hourly; it stays in the soil and trusts the seasons. You are mid-process — and the Guarantor is pleased with the site.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Where have you been measuring change by single bad days instead of trajectory?

— What does “resume quickly” need to look like in your process?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Faithful Guarantor, I trust the process because I trust the Builder. When I stumble, teach me to resume quickly — and carry Your good work in me to completion. Amen.

_May you feel, on your slowest day, the steady hands of the One completing you._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 1:3–6; 1 John 1:8–9$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Matthew 5:14', $dev$“You are the light of the world. A town built on a hill cannot be hidden.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Your change was never only about you. Be transformed to be a transformer — that is heaven’s economy. The renewed mind renews households; the broken pattern liberates children who will never know what almost passed to them; the changed man becomes an environment in which others’ best selves come alive.

Think of who stands downstream of your becoming: a spouse, children, colleagues, a fellowship, a village. Every discipline you have built these ten days is quietly becoming their inheritance.

So receive your commissioning: keep changing, and start transmitting. Tell the story of what God is doing in you — testimony is seed in other people’s soil. Invite someone into your new habits. Be, for another person, the environment you once needed. The seed broke open; now comes the harvest of many seeds.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Who stands downstream of your change — name them?

— What is one way you will transmit this week: a testimony, an invitation, an example?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, make my change contagious. Let the pattern that broke in me stay broken for my children, and let my light be a city some weary traveler finds at night. Amen.

_May generations you will never meet eat from the tree of the change you made today._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 5:13–16; 2 Corinthians 1:3–4$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
