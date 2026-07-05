-- Reseed change-to-become with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Everyone loves the tree. Nobody applauds the seed for splitting. Yet the whole future of an orchard hides in a moment no one watches — the moment a small dry shell, buried in the dark, agrees to stop being a seed.

Jesus spoke these words about Himself, days before the cross. He was explaining His own death and the resurrection harvest that would follow: unless the kernel falls and dies, it stays a single seed forever; but if it dies, it multiplies. This is not a gardening tip. It is the deepest pattern woven into the universe — the way to more always runs through the breaking open of what already is.

And because you are in Christ, that pattern is now yours to live: “If anyone is in Christ, the new creation has come: the old has gone, the new is here” (2 Corinthians 5:17). The power to change is not your willpower straining against your history until it snaps. It is His death-and-resurrection life at work inside you, doing to your old patterns what spring does to a buried seed. Real transformation was always going to feel less like effort and more like surrender.

Here is where most of us get stuck: we want the harvest while keeping the seed-coat intact. New results, but the same protected self. New marriage, same defensiveness. New peace, same grip on control. It cannot be done — the seed that refuses to break simply stays a seed, dry and alone in the ground. So begin this plan the only honest way. Name the old form you have been guarding, and hand God permission to break it open. He is gentle, and He is thorough.

Everything green in your future starts in this small dark surrender.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What "seed-coat" — an old identity, comfort, or pattern — have you been quietly protecting?

— What harvest might be waiting on the other side of letting it break?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You fell into the ground and rose a harvest. Work that same pattern in me. I release the old form I have been guarding, and I trust You to break it open gently. Bring the many seeds. Amen.

_May everything you surrender this week come back to you as harvest._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$John 12:23–26; 2 Corinthians 5:17$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Matthew 4:17', $dev$“From that time on Jesus began to preach, “Repent, for the kingdom of heaven has come near.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$If you could choose the first word of your own ministry — the very first thing the world would hear you say — what would you pick? Jesus chose one word: “Repent.” It sounds like a rebuke. It is actually a doorway.

In the Greek, the word is metanoia — literally, a change of mind. Before heaven rearranges a person's circumstances, it calls for a rearranged mind, because a person always lives at the altitude of their thinking. Jesus did not open with “work harder” or “try again.” He opened at the root, because that is where lasting change is decided.

This ordering can save you years of frustration. Most of us attack our behaviors head-on — the spending, the temper, the scrolling, the procrastination — and we lose, over and over, because behaviors are fruit and minds are roots. You can cut a bad fruit off a tree and it grows right back by summer; but change the root and the whole tree turns. Paul said it plainly: “Be transformed by the renewing of your mind” (Romans 12:2). Transformation and renewed thinking are the same event described twice.

So bring the pattern you carried into this plan and ask it a harder question than usual. Not “how do I stop doing this?” but “what do I believe that keeps this alive?” Listen for the sentence underneath: I need this to cope. I'll always be like this. Everyone in my family is this way. That buried sentence is the root. Change the sentence, and the pattern above it slowly loses its food supply.

Attack the fruit and you will be exhausted by February. Change the root, and the branches change for good.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What belief sits at the root of the pattern you most want broken?

— What is God's replacement sentence for that root?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I bring You roots today, not just fruit. Change my mind where the pattern feeds. Renew my thinking, and let the whole tree of my behavior turn from its base. Amen.

_May the root change quietly this week — and the branches change loudly next season._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 4:17; Acts 3:19$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Numbers 13:30', $dev$“But Caleb… said, “We should go up and take possession of the land, for we can certainly do it.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Twelve men walked into the same land, saw the same giants, ate the same fruit. Twelve came back. Ten of them lost the battle before a single sword was drawn — and they lost it inside their own eyes.

Listen to their report: “We seemed like grasshoppers in our own eyes, and we looked the same to them” (Numbers 13:33). Notice the order. First they shrank themselves in their own estimation; only then did they assume the giants agreed. The defeat was an inside job, a measurement taken in the heart — and that private arithmetic became a forty-year sentence for an entire nation. A whole generation died in a wilderness because of how ten men had learned to see themselves.

Caleb stood in the same spot, under the same shadows, and did the sum differently: “We can certainly do it.” God's verdict on him is the cure written out in full: “Because my servant Caleb has a different spirit and follows me wholeheartedly, I will bring him into the land” (Numbers 14:24). A different spirit. Wholehearted following. And therefore — entrance. The men who saw themselves as grasshoppers got a wilderness; the man who saw himself as God's covenant partner got the land.

Changing to become always requires this exchange of measurements. The first question is never “how big is the obstacle?” It is “how big is my God — and what exactly has He said?” Grasshopper arithmetic feels like humility, but it is really unbelief wearing modest clothes.

So run Caleb's sum on your own giant today. Stand in front of the specific thing you have been shrinking under, and say it out loud: “We can certainly do it — for the Lord is with us.” Then watch your own size change first.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has grasshopper arithmetic been quietly deciding your attempts before you start?

— Apply Caleb's arithmetic to that same giant — what changes?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, give me the different spirit of Caleb. I trade my measurements for Yours, and I refuse to shrink myself where You have made me strong. I will follow You wholeheartedly into the land You have promised. Amen.

_May a different spirit carry you where old arithmetic never could._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Numbers 13:26–14:9, 24$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Daniel 1:8', $dev$“But Daniel resolved not to defile himself…”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$A habit is a decision that has stopped asking for permission. You made the choice once; now it runs on its own, quietly, whether you are inspired or not. That is exactly why habits are so powerful — and why they cut both ways.

The enemy of your soul is rarely threatened by your resolutions. He has watched thousands of them, made with tears on the first of January, buried without ceremony by the middle of February. New Year's promises don't frighten him. Your habits do — the automatic behaviors that no longer stop to consult your mood, that keep going on the days you don't feel like it. A resolution says what you hope. A habit says who you have become.

Daniel shows the whole mechanism. As a teenager, exiled and pressured, he “resolved not to defile himself” — one decision, made in the heart, before the test arrived. And then he simply enforced that single decision, day after day, for the rest of his life. By the time he was an old man and a jealous decree made prayer illegal, his response is almost casual: “Three times a day he got down on his knees… just as he had done before” (Daniel 6:10). The king's law could not reach him, because his knees already had a schedule no decree could interrupt. The crisis met a man whose habits had been holding him for decades.

So change your pattern at the level where it actually lives — not in the noise of feeling, but in the quiet of decision. Pick the one small habit that would most serve your becoming: the early prayer, the daily page, the walk, the tithe, the phone put away at nine. Decide it once, tonight, in the calm. Then let tomorrow do nothing more heroic than obey what yesterday already settled.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Which single habit, kept faithfully for a year, would most change your becoming?

— Decide it once, tonight: when, where, and how small will it start?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$God of Daniel, I make the decision now, in the quiet, before the noise arrives. One holy habit, decided once and kept daily. Hold me to it until it is strong enough to hold me. Amen.

_May one small habit begun this week still be blessing you in ten years._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 1:8–16; 6:10$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Galatians 6:7, 9', $dev$“Do not be deceived: God cannot be mocked. A man reaps what he sows. …Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$There is an old chain worth carving over your front door: sow a thought, reap an action; sow an action, reap a habit; sow a habit, reap a character; sow a character, reap a destiny. Trace any life backwards along that chain and you will always arrive at a seed — usually a small, forgettable, repeated one.

Which means almost nothing about your life is random. It is agricultural. Paul states the law without softening it: “A man reaps what he sows.” We tend to hear that as a threat, a warning finger raised over our failures. But read the whole passage and you will find it is far more friend than judge.

Because if the law is true, then no faithful small thing is ever wasted. Every hidden discipline, every kind word spoken when no one clapped, every temptation resisted in private, every early morning nobody saw — all of it is real seed in real ground. And Paul attaches a promise to it: “At the proper time we will reap a harvest if we do not give up.” The delay between sowing and reaping is not God ignoring you. It is simply the field doing its slow, certain work underground.

The same law makes honest audits kind rather than crushing. Look at any harvest in your life you don't like — the tiredness, the debt, the distance in a relationship — and instead of despairing, trace it back down the chain to the seed at the bottom. That seed is small. That seed is nearby. And that seed is changeable, this very week.

Your destiny is not being decided on the dramatic days. It is being decided on your ordinary Tuesdays. So stop treating them as filler. Sow them on purpose.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Trace one unwanted harvest down the chain — what seed is sitting at the bottom of it?

— What new seed will you begin sowing on your ordinary Tuesdays?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You for a universe where sowing is never wasted and the smallest faithful seed still counts. I take up my seed bag with joy, and I will not grow weary before the proper time. Amen.

_May your ordinary Tuesdays quietly assemble an extraordinary destiny._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Galatians 6:7–10; Hosea 10:12$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Proverbs 22:29', $dev$“Do you see someone skilled in their work? They will serve before kings…”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Your gift will open doors for you. But only your character will keep you in the rooms your gift opens. Many people have been promoted by their talent and demoted by their character inside the same twelve months — the skill got them the platform, and the unchanged self quietly cracked it in two.

Joseph is the great case study, and the Bible does not rush his story for a reason. The gift of interpreting dreams took him from a prison cell to Pharaoh's right hand in a single morning — that part is fast and dramatic. But what kept him standing at the top for the rest of his life was not the gift. It was character, and character had taken years to build: faithfulness in Potiphar's house when no one important was watching, integrity in the dungeon when the promised remembrance never came. Scripture gives us the hidden headline of those slow years: “The word of the Lord tested him” (Psalm 105:19). The delay was not wasted time. The delay was the test that made a ruler.

This reframes your waiting seasons completely. That stretch where nothing seems to be advancing, where the gift feels stuck and the recognition keeps not arriving — that is not God losing track of your calendar. It is God pouring the foundations that will one day carry the full weight of your becoming. Platforms are built fast. Pillars are built slow. And a platform without pillars is just a stage waiting to collapse.

So cooperate with the construction happening in you right now. Integrity when you are unseen. Faithfulness when you go unthanked. Purity when no one is watching. The room your gift will open is already on God's schedule. Your only assignment today is to become the kind of person who can still be standing in it a decade after the door swings wide.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Where is character being built in you right now, through a test that feels like a delay?

— Which trait, if left unchanged, could one day crack the platform your gift is building?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, build pillars in me before You build platforms under me. Test me kindly, shape me thoroughly, and make me someone who can stay faithful in the rooms You open. Amen.

_May your character grow one size larger than every room your gift will ever open._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 39–41; Psalm 105:17–22$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Genesis 12:1', $dev$“The Lord had said to Abram, “Go from your country, your people and your father’s household to the land I will show you.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$The very first instruction God ever gave the father of faith was not spiritual in tone. It was geographic. “Go from your country, your people, your father's household.” Before the promise of a great nation, before the blessing, came two small words with enormous weight: go from.

Some becomings simply cannot happen at the old address. Not because God's power is limited by location — He is not — but because you are limited by environment far more than you like to admit. You are formed, quietly and continuously, by what surrounds you. Seeds understand this instinctively. A seed does not negotiate with the soil; it responds to it. The exact same seed thrives in one field and rots in another. The difference was never the seed. It was the ground.

Your environments are always doing something to what God has planted in you — watering it or withering it, day after day, whether you notice or not. The voices you sit under. The rooms you frequent. The screens you feed on late at night. The atmosphere of your ordinary hours. None of it is neutral. All of it is soil, and all soil either grows you or slowly kills you.

Now, not everyone is called to move cities. But everyone is called to audit environments honestly. Ask the hard question: is there a place, a screen, a circle of people where your worst self grows effortlessly, where the pattern you're trying to break is practically watered for you? And on the other side — is there a fellowship, a mentor's shadow, a table, a room where your best self quietly comes alive?

Then find the courage Abraham found. Leave the one. Plant yourself deliberately in the other. Obedient feet have always been what unlock promised lands.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— In which environment does your worst self grow effortlessly, almost without your help?

— Where does your best self come alive — and how will you make sure you're there more?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father of Abraham, I hold my environments with open hands. Say "go from" where You must, and "go to" where You will — my feet are Yours to send. Amen.

_May your feet find the soil where everything God planted in you finally flourishes._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 12:1–4; Psalm 1:1$dev$),
  (8, 1, 'scripture', 'Today''s Reading', '1 Corinthians 15:33; Proverbs 13:20', $dev$“Do not be misled: “Bad company corrupts good character.” … Walk with the wise and become wise, for a companion of fools suffers harm.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Yesterday we audited places. Today we go one layer deeper, because the most powerful environment in your life is not a place at all. It is people. You are being shaped, right now, by your closest voices — and the shaping is so gradual you rarely feel it happening.

Watch how it works. The expectations of the people nearest you slowly calibrate your own. Their habits normalize themselves in you until yesterday's shock becomes today's ordinary. Their faith is contagious; so is their fear. You do not choose most of this consciously. You simply catch it, the way you catch a mood in a room. Scripture is tender about this but completely unbending: “Bad company corrupts good character.” Notice the verb — corrupts, present tense, patient and unhurried. It does not happen in a dramatic moment. It happens like water shaping stone: slowly, comfortably, without alarm.

But the same law runs gloriously in reverse: “Walk with the wise and become wise.” Nearness transfers. Elisha left his oxen in the field to walk in the dust of Elijah's footsteps, and years of that nearness ended in a double portion of the same spirit. He did not attend a seminar. He walked close, for a long time, and became.

So becoming is partly a matter of walking partners. Look honestly at whose life is currently transferring into yours, and toward what. Then choose on purpose. Identify the people whose walk with God you would genuinely be glad to catch — and get near them, deliberately, repeatedly. And where a particular friendship consistently farms your worst self, don't grow harsh. Love faithfully, but reposition wisely.

Your destiny keeps its company carefully. Ask God to help you keep yours.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which voices are currently calibrating you — and honestly, toward what?

— Whose shadow should you deliberately walk in during this season?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, order my companionships. Give me the humility to walk in wise shadows, the love to bless every person You place near me, and the wisdom to guard my inner circle carefully. Amen.

_May every walking partner God assigns you leave you a little closer to Him._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 13:20; 2 Kings 2:1–14$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Philippians 1:6', $dev$“Being confident of this, that he who began a good work in you will carry it on to completion until the day of Christ Jesus.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$By now, nine days in, you have probably discovered the unglamorous truth about change: it is a process, and every process has a middle. Not the inspiring start, not the triumphant finish — the long, ordinary middle, where progress is real but slow and easy to doubt.

So expect two kinds of days. There will be days you feel genuinely new, when the old self seems like a stranger you used to know. And there will be days the old pattern knocks on the door like it still owns a key — familiar, confident, acting as if nothing has changed at all. Here is what matters: hearing the knock is not the same as opening the door. The temptation to slip back is not proof you have failed. It is just the pattern testing whether you still answer.

Take today's verse as your covenant of process, and lean your full weight on it: “He who began a good work in you will carry it on to completion.” Read that slowly. The One who started your transformation has personally guaranteed its finish. Your becoming has a Guarantor, and He is not the kind of builder who abandons a site half-framed. He finishes what He begins.

That reframes your stumbles entirely. When you fall — and in a real process you will — the family rule is simple and swift: confess quickly, receive mercy quickly, resume quickly (1 John 1:9). Shame drags out the recovery and delays the whole work; grace shortens it and speeds you back to the path. Measure yourself by trajectory, not by any single day. A seed in the soil does not dig itself up every few hours to check for growth. It stays planted and trusts the seasons.

You are mid-process. And the Guarantor is not anxious about the site. He is pleased with it.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Where have you been measuring your change by single bad days instead of by trajectory?

— What does "resume quickly" need to look like the next time you stumble?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Faithful Guarantor, I trust the process because I trust the Builder. When I stumble, teach me to resume quickly instead of hiding in shame. Carry Your good work in me all the way to completion. Amen.

_May you feel, even on your slowest day, the steady hands of the One completing you._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 1:3–6; 1 John 1:8–9$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Matthew 5:14', $dev$“You are the light of the world. A town built on a hill cannot be hidden.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Here is the last surprise of these ten days: your change was never only about you. From the beginning, heaven had someone else in mind. Be transformed, yes — and then be a transformer. That is the economy of the kingdom, where nothing good is ever meant to stop at one person.

Think about what actually happens downstream of a changed life. A renewed mind starts renewing the whole household around it. A pattern finally broken in one generation liberates children who will grow up never knowing what almost passed to them — the anger they never inherited, the fear that never got its grip. A person who has genuinely changed becomes, without even trying, an environment in which other people's best selves come alive. You stop being merely a light and start being a lamp others read by.

So name them. Who stands downstream of your becoming? A spouse learning to trust again. Children watching more than they listen. Colleagues, a fellowship, a whole community, a village. Every discipline you have quietly built over these ten days is already becoming their inheritance, whether they can see it yet or not. Jesus said it plainly: “A town built on a hill cannot be hidden.” Real change does not stay private. It gets seen, and it lights the way home for someone still walking in the dark.

So receive your commissioning today. Keep changing — the work is not finished — but start transmitting. Tell the story of what God is doing in you, because your testimony is seed sown into someone else's soil. Invite a person into the new habits you have built. Become, for one weary traveler, the very environment you once desperately needed and could not find.

The seed broke open on Day One. Now comes the whole point of the breaking: the harvest of many seeds.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Who stands downstream of your change — can you name them?

— What is one way you will transmit this week: a testimony, an invitation, or an example?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, make my change contagious. Let the pattern that broke in me stay broken for my children and their children. And let my light become a city on a hill that some weary traveler finds at night. Amen.

_May generations you will never meet eat from the tree of the change you made today._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 5:13–16; 2 Corinthians 1:3–4$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
