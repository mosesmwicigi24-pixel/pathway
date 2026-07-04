-- Seed 7 standalone study plans from 'The Power to Become' (Moses Mwicigi):
-- First Steps (7d) + six 10-day plans. Each day: key verse (scripture) ->
-- Devotional -> Talk it Over (Reflect) -> Pray (+blessing) -> Go Deeper.
-- No videos: the video segment row is simply absent. Re-runnable: plans
-- upsert by code and days are cleanly reseeded.

-- Up Migration

-- ====================================================================
-- why-am-i-here (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('why-am-i-here', 'Why Am I Here?', 'Ten days from drifting to living on purpose', 'There is a hunger that success cannot feed and busyness cannot silence: the question of purpose. You can have the job, the family, the achievements — and still lie awake wondering, is this all? Why am I actually here? That question is not a crisis. It is an invitation. You were not born to find your purpose by trial and error; you were born with your purpose already written, waiting to be discovered. For ten days we will follow the trail — through your burdens, your gifts, your seasons and your service — until the question that kept you awake becomes the assignment that gets you up in the morning. Jesus could say in one sentence why He came. By day ten, you will be closer to saying the same.', 'Purpose', 10, 11, 'https://images.unsplash.com/photo-1533105079780-92b9be482077?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'why-am-i-here');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'John 18:37', 'The Man Who Knew Why'),
  (2, 'Isaiah 43:6–7', 'Made for His Glory'),
  (3, 'Jeremiah 1:5', 'Sent, Not Dropped'),
  (4, 'Colossians 3:23', 'Your Work Is a Sanctuary'),
  (5, 'Nehemiah 1:3–4', 'Follow Your Holy Burden'),
  (6, 'Nehemiah 2:8', 'The Three Ps of Purpose'),
  (7, 'Ecclesiastes 3:1', 'Don''t Eat Your Dinner in the Morning'),
  (8, 'Mark 10:45', 'Purpose Is Discovered on Your Knees — Serving'),
  (9, 'Psalm 138:8', 'Praise Finds Its Voice in Purpose'),
  (10, 'John 17:4', 'Finish the Work')
) AS v(n, ref, title) WHERE p.code = 'why-am-i-here';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'why-am-i-here'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'John 18:37', '“You say that I am a king. In fact, the reason I was born and came into the world is to testify to the truth.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Standing on trial for His life, Jesus said something no anxiety could shake: the reason I was born. He knew it. He had always known it — at twelve in the temple (“I must be about my Father''s business”), at the peak of fame (“let us go somewhere else — that is why I have come”), and at the end (“I have finished the work you gave me”). A man who knows why he was born cannot be scattered by applause or dismantled by opposition. Purpose was Christ''s spine — and here is the gospel of it: in Him, purpose becomes yours too. “We are God''s workmanship, created in Christ Jesus to do good works, which God prepared in advance” (Ephesians 2:10). The works are prepared. The plan of these ten days is simply to find what already has your name on it.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— Could you complete the sentence "the reason I was born is…"? What comes out?

— What would change in your week if that sentence were settled?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You knew why You were born — and You hold the reason I was. Walk me through these ten days until my purpose moves from mystery to assignment. Amen.

_May the question that kept you awake become the assignment that wakes you up._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'John 18:33–37; Ephesians 2:8–10'),
  (2, 1, 'scripture', 'Today''s Reading', 'Isaiah 43:6–7', '“Bring my sons from afar and my daughters from the ends of the earth — everyone who is called by my name, whom I created for my glory, whom I formed and made.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Before purpose gets specific, it gets simple: you were created for the glory of God. That is the headline over every human life — created, formed and made for His glory. This is not a small answer; it is a liberating one. It means your purpose is not hiding in some distant achievement you may never reach. You can fulfill the deepest layer of your purpose today — in how you work, love, speak and worship. “Whether you eat or drink or whatever you do, do it all for the glory of God” (1 Corinthians 10:31). Everything else this plan uncovers — your assignment, your gifts, your timing — sits on this foundation. Purpose is not first a task. It is first a direction: a life angled toward the pleasure of the One who made it.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— If glory to God is the headline, what would today look like lived under it?

— Where have you been seeking a purpose that impresses people more than one that honors God?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, before I ask what to do, I settle who it is for. I was created for Your glory — let every ordinary hour of this day be angled toward You. Amen.

_May your most ordinary hours begin to shine with the glory they were made for._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Isaiah 43:1–7; 1 Corinthians 10:31'),
  (3, 1, 'scripture', 'Today''s Reading', 'Jeremiah 1:5', '“Before I formed you in the womb I knew you, before you were born I set you apart; I appointed you as a prophet to the nations.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Notice the order of Jeremiah''s calling: known, set apart, appointed — all before birth. He did not arrive on earth and then look around for something useful to do. The assignment predated the arrival. He was sent, not dropped. So were you. Before the beginning of time, God established the times when you would live and set apart the work, the mandate, the assignment you would need to accomplish. Your birth was heaven deploying a solution to problems it had already scheduled you to meet. This changes the search entirely: you are not inventing a purpose out of your preferences. You are discovering an appointment that was made without your permission — and it is better than anything you would have designed.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Do you live like someone dropped into the world, or someone sent into it?

— What problems around you stir you as though they were scheduled for you?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, I was known, set apart and appointed before I was born. Open the sealed orders. I am ready to discover what You sent me here to do. Amen.

_May you feel today the dignity of a sent person walking an appointed earth._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Jeremiah 1:4–10; Psalm 139:16'),
  (4, 1, 'scripture', 'Today''s Reading', 'Colossians 3:23', '“Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Many people think purpose requires leaving their job for a pulpit. Hear this clearly: purpose is not a change of address; it is a change of orientation. The farm, the classroom, the clinic, the shop — any honest work becomes a sanctuary the moment it is done as for the Lord. If a man is called to be a street sweeper, let him sweep streets the way Michelangelo painted — that is how a calling behaves in ordinary clothes. Daniel served a government; Lydia sold cloth; Joseph administered grain. Scripture''s purposeful people were mostly not clergy. So do not despise your current desk — it may be the very ground of your assignment. Work done with all your heart, for His eyes, is worship with its sleeves rolled up.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— How would tomorrow''s work change if the Lord were your only supervisor?

— What excellence have you been withholding because "it''s just a job"?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Lord, I re-orient my work: same desk, new Master. Receive my labor this week as worship, and let my excellence preach where my words cannot. Amen.

_May your workplace quietly become an altar this week._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Colossians 3:22–24; Proverbs 22:29'),
  (5, 1, 'scripture', 'Today''s Reading', 'Nehemiah 1:3–4', '“They said to me, “Those who survived… are in great trouble and disgrace. The wall of Jerusalem is broken down.” When I heard these things, I sat down and wept.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Nehemiah was a cupbearer, comfortable in a palace — until a report about broken walls broke his heart. He wept, fasted, prayed. That weight had an assignment inside it: the man who cried over the walls became the man who rebuilt them. Here is one of purpose''s most reliable compasses: your destiny is often birthed from your burden. Not every sad story moves you — but some particular brokenness does: the fatherless, the addicted, the unschooled, the church''s coldness, a community''s poverty. That specific ache is not weakness. It is a map. What makes you weep or makes you righteously angry is worth interrogating in prayer. God often addresses His repairs to the hearts that feel the damage most.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— What brokenness moves you more than it seems to move others?

— If your burden had an assignment inside it, what might it be?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, I stop apologizing for the ache. Show me the assignment inside my burden, and give me Nehemiah''s courage to move from weeping to building. Amen.

_May your deepest ache reveal itself as your clearest assignment._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Nehemiah 1:1–11; Judges 6:11–14'),
  (6, 1, 'scripture', 'Today''s Reading', 'Nehemiah 2:8', '“And the king granted them to me, because the good hand of my God was upon me.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Watch Nehemiah''s burden become a mission, and you will see three confirmations that still mark a true purpose. Passion: when God calls you to something, He plants a holy restlessness for it — Nehemiah could not rest while the walls lay in ruins. When God calls you to do something, go and do it. Possibilities: God opens doors you did not push. The king granted leave, letters and timber — opportunity moved toward the assignment. And when a door refuses to move, ask the discerning question: is it not yet the time, or am I not the person for it? Provision: resources follow the call (Nehemiah 2:7–9). Where God guides, He provides. Under these three, a wall that had shamed a nation for a century was finished in fifty-two days.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Where do passion, possibility and provision currently overlap in your life?

— Which of the three are you waiting on — and what would faithful waiting look like?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, confirm my path the Nehemiah way: plant the passion, open the possibilities, send the provision. And when all three align, give me speed to build. Amen.

_May doors you never pushed begin to move for you._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Nehemiah 2:1–9; 6:15–16'),
  (7, 1, 'scripture', 'Today''s Reading', 'Ecclesiastes 3:1', '“There is a time for everything, and a season for every activity under the heavens.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'In purpose, timing is very important — don''t eat your dinner in the morning. A right assignment forced into the wrong season produces the same result as a wrong assignment: frustration. The mango ripened in its season is sweeter than the one forced ripe in a sack. David was anointed king years before he wore a crown — and he did not force the throne, even when Saul was within a spear''s reach of being removed. He let God''s timing do the promoting, and his kingdom stood. Purpose therefore requires two disciplines, not one: knowing what you are called to, and discerning when. Ask God not only “what is my assignment?” but “what does this season require?” Preparation seasons are not delays; they are dinner cooking.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Where might you be forcing dinner in the morning — right call, wrong hour?

— What does your current season actually require of you: building, waiting, learning, or launching?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Lord of seasons, save me from harvesting early and from sleeping late. Name my current season, and give me the grace to do exactly what it requires. Amen.

_May every purpose in your life ripen sweetly in its season._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Ecclesiastes 3:1–11; 1 Samuel 26:9–11'),
  (8, 1, 'scripture', 'Today''s Reading', 'Mark 10:45', '“For even the Son of Man did not come to be served, but to serve, and to give his life as a ransom for many.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Many people who reached their destiny first learned to be servants. Joseph served in Potiphar''s house and in prison before he governed Egypt. Joshua served Moses; Elisha poured water on Elijah''s hands; David served Saul''s household with a harp. Serving is not the delay of destiny — it is the discovery of it. Why? Because your destiny is discovered when you serve. Service puts your gifts in motion where you can finally observe them; it grows you in another man''s vineyard until God plants you in your own; and it kills the pride that ruins purpose at the root. If you cannot yet see your purpose, do not stand still squinting at the horizon. Find a place to serve — this week — and watch what rises in your hands.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Where are you currently serving with no title and no spotlight?

— What have you noticed rising in your hands when you serve others?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You came to serve — make me like You. Lead me to a vineyard where I can pour water on another''s hands, and reveal my purpose in the pouring. Amen.

_May a towel in your hands do what a title never could._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Mark 10:42–45; 2 Kings 3:11; Luke 16:12'),
  (9, 1, 'scripture', 'Today''s Reading', 'Psalm 138:8', '“The Lord will vindicate me; your love, Lord, endures forever — do not abandon the works of your hands.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Something happens to worship when purpose awakens: it finds its voice. When you put praise into your purpose, it releases the power that changes life. A person who knows they are on assignment thanks God differently — the singing gets personal. And the reverse is also true: gratitude keeps purpose healthy. Purpose without praise curdles into ambition; the mission becomes about you. Daily thanksgiving keeps the assignment in its Owner''s name. Today''s verse is the worker''s anthem: the Lord will fulfill his purpose for me. Not “I will grind my purpose into existence” — He fulfills; you cooperate. So build the habit now: every step of progress, praise; every closed door, praise; every small beginning, praise. Purpose walks farthest on grateful legs.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Has your pursuit of purpose been fueled more by ambition or by gratitude lately?

— What progress — however small — deserves your praise today?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, I put praise inside my purpose. Thank You for what You have already done and for what is already written. Fulfill Your purpose for me — I will thank You at every mile. Amen.

_May gratitude carry your purpose farther than ambition ever could._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Psalm 138; Philippians 1:6'),
  (10, 1, 'scripture', 'Today''s Reading', 'John 17:4', '“I have brought you glory on earth by finishing the work you gave me to do.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Here is how Jesus measured a completed life — not by doing all possible work, but by finishing the work you gave me. There were still sick people in Israel when He prayed this; still villages unvisited. Purpose is not the exhaustion of every need around you. It is the completion of the specific lines written in your book. And of David the Scripture records the epitaph every becomer should covet: “when David had served God''s purpose in his own generation, he fell asleep” (Acts 13:36). His own generation — the only one he was given. So go now with the compass of these ten days: made for His glory, sent with an assignment, guided by burden, gifts, seasons and service. You do not need to do everything. You need to finish yours.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Write your own John 17:4 sentence: what work must you finish before you sleep?

— What is the very next faithful step toward it — this week?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, one prayer for the rest of my days: let me finish the work You gave me. Not everyone''s work — mine. And when I sleep, let it be said I served Your purpose in my generation. Amen.

_May you live so purposefully that your last prayer can be "I have finished the work."_'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'John 17:1–4; Acts 13:36; 2 Timothy 4:7')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- ask-better (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('ask-better', 'Ask Better', 'The questions that unlock your life', 'Show me a person''s questions and I will show you the direction of their life. Some questions are keys; some are cages. Why does this always happen to me? Why am I so unlucky? — ask those long enough and life will faithfully deliver you their answers. Jesus, the master teacher, taught by questions — over a hundred of them in the gospels. Before Peter received the revelation of the rock and the keys of the kingdom, he first had to stand before a question: “Who do you say I am?” The question opened the gate; the revelation walked in behind it. For ten days, we will renovate your inner interrogation room. Great questions attract great answers — and heaven still answers the one who dares to ask.', 'Growth', 10, 12, 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'ask-better');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Matthew 16:15–16', 'The Teacher Who Asked'),
  (2, 'Matthew 7:7', 'Questions Are Seeds'),
  (3, 'Romans 12:2', 'Retire the Defeated Questions'),
  (4, 'Genesis 3:9', 'The God Who Asks "Where Are You?"'),
  (5, 'Proverbs 20:5', 'Go Deeper Than the First Answer'),
  (6, '1 Samuel 17:26', 'Question Your Assumptions'),
  (7, 'James 1:5', 'Ask for Wisdom — He Gives Generously'),
  (8, 'Psalm 25:4', 'The Six Questions of Destiny'),
  (9, 'Luke 11:8', 'Keep Knocking'),
  (10, 'Psalm 139:23–24', 'Search Me — the Prayer of the Open Life')
) AS v(n, ref, title) WHERE p.code = 'ask-better';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'ask-better'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Matthew 16:15–16', '“But what about you?” he asked. “Who do you say I am?” Simon Peter answered, “You are the Messiah, the Son of the living God.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'At Caesarea Philippi, Jesus did not open with a lecture. He opened with a question — first the easy one (“Who do people say I am?”), then the one that changes lives: “Who do you say I am?” Notice the sequence: question, then confession, then revelation, then keys. Peter''s answer unlocked a blessing — “this was not revealed to you by flesh and blood, but by my Father in heaven” — and a destiny: the rock, the church, the keys of the kingdom. Heaven still works this way. Revelation answers the man who dares to ask — and to be asked. So this plan begins where discipleship begins: let Jesus'' question sit on you today, unhurried. Who do you say He is? Everything else you will ever ask stands on that answer.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— Who do you say Jesus is — in your own unborrowed words?

— How does your answer to that question shape every other question you ask?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You are the Messiah, the Son of the living God — my answer and my Answerer. Teach me this week to ask the way You taught: questions that open gates. Amen.

_May the greatest question ever asked find its firmest answer in you._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Matthew 16:13–20'),
  (2, 1, 'scripture', 'Today''s Reading', 'Matthew 7:7', '“Ask and it will be given to you; seek and you will find; knock and the door will be opened to you.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'The direction of your life follows the direction of your questions. A question is a seed for an answer — plant it, and life begins arranging a harvest to match. Ask “how can I grow from this?” and your mind hunts growth. Ask “why does this always happen to me?” and your mind faithfully gathers evidence of doom. Psychologists observe that the brain answers whatever it is asked — it is an obedient search engine. Scripture said it first and deeper: ask, seek, knock, and doors respond. So take an audit today. Listen to the questions running under your thoughts like a soundtrack. They are seeds already in the soil. The good news of this whole plan: seeds can be exchanged, and a new planting can begin this very week.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— What three questions do you ask yourself most often? Write them down honestly.

— What harvest are those questions currently arranging?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, You have shown me that my questions are seeds. Walk with me through my inner soil this week — help me uproot what I never meant to plant. Amen.

_May every seed you plant with your questions grow into a harvest worth eating._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Matthew 7:7–11; Proverbs 4:23'),
  (3, 1, 'scripture', 'Today''s Reading', 'Romans 12:2', '“Do not conform to the pattern of this world, but be transformed by the renewing of your mind.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Some questions are accusations wearing the clothes of questions: Why can''t I ever succeed? Why am I so unlucky? Why are all men — all women — the same? Why am I the only one facing such battles? They pretend to seek answers, but they have already ruled. The verdict is hidden inside the question. These are circular circles of no change: the question assumes defeat, the answer confirms defeat, and a man walks the same road another year and calls it fate. Today, hold a retirement ceremony. Name your defeated questions — out loud — and dismiss them from service. They have worked in your life long enough. Tomorrow we will hire their replacements; today, simply and firmly, let them go.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Which defeated question has served longest in your inner life?

— What has it cost you across the years — in hope, in courage, in attempts?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, today I retire the questions that always ruled against me. I dismiss them in Jesus'' name. Prepare my heart to hire the questions of life. Amen.

_May the old interrogators of your soul be found unemployed from today._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Romans 12:1–2; Philippians 4:8'),
  (4, 1, 'scripture', 'Today''s Reading', 'Genesis 3:9', '“But the Lord God called to the man, “Where are you?”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'The first question in the Bible is not asked by man to God, but by God to man — and hear its tone rightly. The all-knowing God was not requesting coordinates. Where are you? was a father''s question, designed to draw a hiding son out of the bushes into honesty. God''s questions locate; they do not humiliate. To Elijah under the broom tree: “What are you doing here?” To the blind man: “What do you want me to do for you?” To Peter, thrice: “Do you love me?” Every one an open door dressed as an inquiry. God may be asking you one of His questions right now. Do not answer it the way Adam did — with hiding and blame. Answer it in the open: here I am. Honest location is where every restoration begins.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— If God asked you "Where are you?" today — honestly — what is the answer?

— What question does He seem to be asking you in this season?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, here I am — no bushes, no blame. Ask me Your questions, and give me the honesty to answer from where I truly stand. Amen.

_May you step out of every bush and find that His voice was mercy all along._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Genesis 3:8–13; 1 Kings 19:9–13; John 21:15–17'),
  (5, 1, 'scripture', 'Today''s Reading', 'Proverbs 20:5', '“The purposes of a person’s heart are deep waters, but one who has insight draws them out.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'It seems when people question, they don''t go deep enough. They deliberately ignore the answers that will serve them — because the second answer usually costs something the first one does not. Ask “what happened?” and you get a story. Ask “why did it happen?” and you get a pattern. Ask “what was my part in it?” and you get a mirror. Ask “what must I become so it does not happen again?” and you finally get a door. Most people stop at the story. The becoming ones keep drilling. The best questions often lead to uncomfortable truths — embrace the discomfort, for it is the labor ward of growth. Deep waters do not surrender their treasure to a shallow bucket. Draw deep this week.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Where did you recently stop at the first answer because the second would cost you?

— Take one recurring frustration: what is your part in it — honestly?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, give me a deeper bucket. I choose the uncomfortable second answer over the comfortable first one. Draw out of me what I have avoided knowing. Amen.

_May the deep waters of your heart yield treasure to your drawing this week._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 20:5; Psalm 51:6; Haggai 1:5–7'),
  (6, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:26', '“David asked the men standing near him, “…Who is this uncircumcised Philistine that he should defy the armies of the living God?”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'For forty days an entire army operated on one unexamined assumption: Goliath cannot be beaten. Nobody had voted on it; it had simply settled over the valley like weather. Then a shepherd boy arrived and asked a different question — not “how big is he?” but “who is he, to defy the armies of the living God?” One question re-framed the entire battle. The giant did not change; the assumption did. Many of our prisons have unlocked doors — held shut only by beliefs we never interrogate: there is only one option; people like me don''t succeed; it is too late for this dream. Today, put your oldest assumption on trial. Ask it for its evidence. You may discover, as Israel did, that the thing which silenced you for forty days falls to a single well-aimed question.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— What "everyone knows" assumption has been governing your decisions?

— What question would David ask about your Goliath?'),
  (6, 4, 'devotional', 'Pray', NULL, 'God of David, teach me to question the weather of assumptions. Where a lie has ruled unexamined, give me the one question that brings it down. Amen.

_May one brave question topple what forty days of fear could not._'),
  (6, 5, 'reading', 'Go Deeper', NULL, '1 Samuel 17:20–37; Numbers 13:30–33'),
  (7, 1, 'scripture', 'Today''s Reading', 'James 1:5', '“If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Here is a promise so generous we hardly believe it: God answers wisdom-requests without finding fault. He does not say, “You should know this by now.” He does not review your record. He gives — generously, to all who ask. Solomon stood at the same door. Offered anything, he asked for a discerning heart — and God was so pleased with the question that He added everything Solomon had not asked for (1 Kings 3:10–13). Heaven rewards good asking. Much of what we lack, we simply have not asked for (James 4:2). So make asking a discipline: before the meeting, the decision, the difficult conversation — “Father, wisdom.” Two words, prayed honestly, have redirected more lives than a thousand hours of worry.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— What decision are you currently carrying that you have worried about more than you have asked about?

— What would "asking first" look like as a daily habit?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, I lack wisdom and You love to give it. For every decision on my desk this week — wisdom. I ask in faith, expecting a generous answer. Amen.

_May generous wisdom arrive ahead of every decision you face this week._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'James 1:2–8; 1 Kings 3:5–14'),
  (8, 1, 'scripture', 'Today''s Reading', 'Psalm 25:4', '“Show me your ways, Lord, teach me your paths.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'A person of purpose should sit regularly before six great questions. Who am I? — the question of identity. Where did I come from? — the question of origin. Why am I here? — the question of purpose. What can I do? — the question of potential. Where am I going? — the question of destiny. What should I become? — the question of growth. These are not questions you answer once; they are companions you walk with, and their answers deepen every season you ask them. Notice something beautiful: this whole journey of plans is built on them. You have already sat with identity and origin; you are sitting with purpose now; potential and destiny are ahead. The examined life is not a philosopher''s luxury — it is a disciple''s habit.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Which of the six questions have you never seriously sat with?

— Schedule it: when, this week, will you give that question an unhurried hour?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Lord, I take up the six great questions as lifelong companions. Show me Your ways, teach me Your paths, and answer me a little more deeply in every season. Amen.

_May the six great questions become six old friends who always lead you home._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Psalm 25:4–5, 12–14'),
  (9, 1, 'scripture', 'Today''s Reading', 'Luke 11:8', '“Because of your shameless audacity he will surely get up and give you as much as you need.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Jesus told of a man knocking on a friend''s door at midnight — refused once, knocking still — and praised his shameless audacity. Then He gave the grammar of kingdom asking: ask, and keep asking; seek, and keep seeking; knock, and keep knocking — the verbs are continuous. Some answers are on the other side of persistence, and heaven has reasons: persistence purifies the request (casual wishes fall away), enlarges the vessel (you grow while you knock), and times the answer to the season it belongs in. Daniel prayed twenty-one days before the answer that had been dispatched on day one broke through. Do not let day twenty be the day you stop. The door is not deaf; it is testing your certainty that this request truly belongs to you.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— What request did you quietly stop knocking on — and was it fatigue or wisdom that stopped you?

— What is worth resuming with "shameless audacity" this week?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, renew my knuckles. For the request You planted in me, I resume asking, seeking, knocking — with the audacity of a man who knows whose door it is. Amen.

_May midnight doors open to your knocking this season._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Luke 11:5–13; 18:1–8; Daniel 10:12–13'),
  (10, 1, 'scripture', 'Today''s Reading', 'Psalm 139:23–24', '“Search me, God, and know my heart; test me and know my anxious thoughts. See if there is any offensive way in me, and lead me in the way everlasting.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'The final upgrade is the bravest: turn the questioning over to God. David — the man who asked so many questions of life — ends his greatest psalm by handing God the interrogation: Search me. Test me. See. Lead. This is the prayer of an open life: no locked rooms, no bushes to hide in, no defended blind spots. It is also the safest prayer in the world, because the Searcher is the same God whose thoughts toward you are precious and vast as sand (Psalm 139:17–18). He searches with a lamp, not a sword. So here is your commissioning from these ten days: live examined. Ask better of yourself, ask boldly of God, and let God ask freely of you. The gate-opening question at Caesarea Philippi has a twin that never stops working: Lord — what do You say about me, and what are You asking of me now?'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Is there a room in your life you have kept off-limits to God''s questions?

— What has this plan changed about the way you will ask — and be asked?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Search me, God, and know my heart; test me and know my anxious thoughts. See what I cannot see, say what I need to hear, and lead me in the way everlasting. Amen.

_May you live gladly examined — asked, answered, and led all your days._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Psalm 139; Hebrews 4:12–13')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- the-renewed-mind (15 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('the-renewed-mind', 'The Renewed Mind', 'Fifteen days to think like heaven thinks', 'Your mind is not a spectator of your life; it is the workshop where your life is manufactured. Every habit you keep, every word you speak, every risk you take or refuse — all of it is drawn first on the drawing board of your thoughts. This is why the greatest battles of your becoming are fought between your ears. The Scripture''s invitation is breathtaking: “Be transformed by the renewing of your mind” (Romans 12:2) — and the word ''transformed'' is the very word used when Jesus was transfigured and His face shone like the sun. What is on offer is not a slight mental adjustment. It is transfiguration, from the inside out. Fifteen days. One workshop. By the end, you will know the Renewer, His method, and your part in the work.', 'Mind', 15, 13, 'https://images.unsplash.com/photo-1499209974431-9dddcece7f88?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'the-renewed-mind');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Matthew 17:2', 'The Mountain Where the Word Was Coined'),
  (2, '2 Corinthians 10:4–5', 'The Battlefield Between Your Ears'),
  (3, 'Ephesians 4:23', 'Your Mind Has a Posture'),
  (4, 'Jeremiah 17:9', 'Why Education Is Not Enough'),
  (5, 'Titus 3:5', 'The Renewer Himself'),
  (6, '2 Corinthians 3:18', 'Beholding Is Becoming'),
  (7, '2 Corinthians 3:6', 'Not a New List — a New Life'),
  (8, '2 Corinthians 10:5', 'Arrest Every Thought'),
  (9, 'Philippians 4:8', 'Replace — Don''t Just Resist'),
  (10, 'Proverbs 4:23', 'Guard the Gates'),
  (11, 'Joshua 1:8', 'Meditation: Digesting the Word'),
  (12, 'Matthew 13:31–32', 'One Thought Is All It Takes'),
  (13, 'Proverbs 23:7', 'Your Mentality Is Your Reality'),
  (14, 'Ephesians 3:20', 'Sanctified Imagination'),
  (15, 'Romans 12:2B', 'The Renewed Mind Discerns the Will of God')
) AS v(n, ref, title) WHERE p.code = 'the-renewed-mind';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'the-renewed-mind'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Matthew 17:2', '“There he was transfigured before them. His face shone like the sun, and his clothes became as white as the light.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Begin where the word begins. “Be transformed” in Romans 12:2 is metemorph■th■ — the same word the gospels use for one event only: Jesus on the mountain of transfiguration, glory breaking through from within until His face shone. Mark the magnitude, because it sets the ceiling for this whole plan. When God speaks of transforming your mind, He is not offering new manners or a tidier attitude. He is offering the family miracle: inward glory becoming outward reality. “Then the righteous will shine like the sun in the kingdom of their Father” (Matthew 13:43). Fifteen days from now you will not merely think more positively. You will be further along the road of transfiguration — and the Christ who shone on that mountain is Himself the light you will be filled with.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What have you been expecting from God — adjustment or transfiguration?

— Where in your thinking do you most long for glory to break through?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You shone on the mountain — and You offer transformation from the same root. Set my expectation high: begin transfiguring my mind from within. Amen.

_May the ceiling of your expectation rise to the height of His promise._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Matthew 17:1–8; Romans 12:1–2'),
  (2, 1, 'scripture', 'Today''s Reading', '2 Corinthians 10:4–5', '“The weapons we fight with… have divine power to demolish strongholds. We demolish arguments and every pretension that sets itself up against the knowledge of God, and we take captive every thought to make it obedient to Christ.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Every visible battle in your life was first a battle in your thinking. Paul names the enemy''s fortifications precisely: arguments, pretensions, strongholds — established patterns of thought that defend themselves like walled cities. You know your strongholds by their age and their armor: the interpretations you have held so long they feel like eyesight itself. Nothing works for me. I am what happened to me. People always leave. But read the good news in the verse: divine power to demolish. Not manage, not decorate — demolish. This plan is a demolition-and-construction contract, and the Contractor has never lost a job. Today, simply survey the site: name your oldest stronghold without shame. Marked walls fall first.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Which thought-pattern in you is so old it feels like eyesight?

— What would your life look like with that wall gone?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, I open the site to You. Here are my walls — the arguments and old interpretations. I believe in divine power to demolish. Begin the demolition. Amen.

_May the oldest wall in your thinking hear its first crack today._'),
  (2, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 10:3–5'),
  (3, 1, 'scripture', 'Today''s Reading', 'Ephesians 4:23', '“Be made new in the attitude of your minds.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Here is a discovery that explains years of frustration: the mind does not merely hold views; it holds a viewpoint. Paul says “be renewed in the spirit of your mind” — the mind has a spirit, a posture, a bearing, a lean. Two people receive identical news; one''s mind leans toward hope, the other''s toward doom. Same facts, different posture. This is why information alone never transformed anyone. You can pour right facts into a wrongly-postured mind and it will bend them all toward the old conclusion — like water finding the old riverbed. So renewal aims deeper than your opinions; it aims at your lean. And leans can be retrained: what you behold, rehearse and thank God for, day after day, slowly becomes the new direction your mind falls toward. We are not changing your answers first. We are changing your tilt.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Which way does your mind lean when news is neutral — toward hope or toward dread?

— Where did that lean come from?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, renew not only my thoughts but my tilt. Retrain the posture of my mind until hope is the direction I naturally fall. Amen.

_May your mind learn to lean, all by itself, toward hope._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 4:20–24'),
  (4, 1, 'scripture', 'Today''s Reading', 'Jeremiah 17:9', '“The heart is deceitful above all things and beyond cure. Who can understand it?”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Many believe the mind''s only problem is missing information — educate people enough and society will heal itself. But look honestly around: education has also produced brilliant fraudsters, learned schemers and eloquent deceivers. The problem of the mind is deeper than ignorance. Scripture''s diagnosis is humbling: our minds are not merely finite — they are fallen. Left to themselves they resist seeing God as more worthy than ourselves and our projects. You know this of your own mind by a simple test: how little effort it takes to think about yourself, and how much it takes to fix your thoughts on God. But every honest diagnosis in the gospel is a doorway to grace. What education cannot reach, the Spirit can — and tomorrow we meet the Renewer Himself. Today, simply agree with the Physician: my mind needs more than information. It needs renewal.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Where have you hoped that knowledge alone would change you — and found it didn''t?

— What does the "effort test" reveal about your mind''s natural direction?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, I agree with Your diagnosis: my mind needs renewal, not just data. I bring You the patient. Heal what information could not. Amen.

_May honest diagnosis open the door to deep healing this week._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Jeremiah 17:9–10; Romans 1:21–25'),
  (5, 1, 'scripture', 'Today''s Reading', 'Titus 3:5', '“He saved us… through the washing of rebirth and renewal by the Holy Spirit.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Whose work is the renewal of your mind? Before it is ever yours, it is His. The only other place Scripture uses Romans 12:2''s word “renewal” is here — renewal by the Holy Spirit. The Spirit renews the mind; it is first and decisively His work. And He works in two directions at once. From the outside in: He brings your mind under Christ-exalting truth — the Word read, preached, meditated. From the inside out: He softens the hard heart that would otherwise reject that truth. Truth without a softened heart is refused; a softened heart without truth has nothing to embrace. He supplies both. Feel the relief of this: you are not the engine of your transformation — you are the site of it. Your part, which the coming days will train, is glad cooperation with a Worker who never abandons a project.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Have you been straining as the engine of your own change, or cooperating with the Worker?

— Which do you need more today — truth for the mind, or softening for the heart?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Holy Spirit, Renewer of minds, I hand You the project. Work from the outside in with truth, and from the inside out with tenderness — and teach me to cooperate. Amen.

_May you feel the relief of being a building site, not a builder, today._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Titus 3:4–7; Ezekiel 36:26–27'),
  (6, 1, 'scripture', 'Today''s Reading', '2 Corinthians 3:18', '“And we all, who with unveiled faces contemplate the Lord’s glory, are being transformed into his image with ever-increasing glory, which comes from the Lord, who is the Spirit.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Here is the Spirit''s method, in one verse: transformation happens by beholding. As we contemplate the glory of the Lord, we are changed into what we gaze at — from one degree of glory to another. Beholding is becoming. This is a universal law you have already lived under: whatever your mind beholds daily has been shaping you all along — the news you soak in, the feeds you scroll, the fears you rehearse. Nobody escapes the law; we only choose our object. So the strategy of renewal is gloriously simple: give your gaze to Christ. Read the gospels slowly and watch Him. Worship with attention. Meditate on His kindness, His courage, His cross. The mind that beholds Jesus daily is being renovated by what it watches — and the change arrives the way sunrise does: gradually, then unmistakably.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— What has your mind been beholding most this month — and what is it making of you?

— How will you build a daily "gaze window" for beholding Christ?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Lord, I choose my gaze. Unveil my face before Your glory daily, and change me by what I watch — from one degree of glory to another. Amen.

_May what you behold this week begin, visibly, to become you._'),
  (6, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 3:12–18; Hebrews 12:1–2'),
  (7, 1, 'scripture', 'Today''s Reading', '2 Corinthians 3:6', '“For the letter kills, but the Spirit gives life.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Beware the counterfeit of renewal: swapping the to-do list of the flesh for the to-do list of religion. A man can cancel every worldly behavior and remain untransformed — same heart, new rules; the cage repainted, the bird unchanged. Watch Paul''s logic: when he lists the works of the flesh, he does not answer them with works of law — he answers with the fruit of the Spirit (Galatians 5:19–22). Works are manufactured; fruit is grown. Lists press from the outside; life pushes from the inside. This is the dignity of what God is doing in you: not behavior management but nature change — “a profound, Spirit-wrought change from the inside out.” So measure your progress by the right meter. The question is not only “what did I avoid this week?” but “what is growing in me?” Love. Joy. Peace. The orchard is the evidence.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Where has your Christianity been list-keeping rather than fruit-growing?

— Which fruit of the Spirit is visibly growing in you this season? Which is budding?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, save me from the repainted cage. Grow Your fruit in me from the inside out, and let my life be evidence of a changed nature, not a managed one. Amen.

_May something sweet and unmistakable grow in your orchard this month._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Galatians 5:16–25; 2 Corinthians 3:4–6'),
  (8, 1, 'scripture', 'Today''s Reading', '2 Corinthians 10:5', '“…we take captive every thought to make it obedient to Christ.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Now your part of the work begins, and it starts with an arrest warrant. “Take captive every thought” — the picture is military: a checkpoint at the border of your mind, where thoughts are stopped, questioned and processed before they settle. Most thoughts enter unexamined. They arrive dressed as your own voice, claiming citizenship — but many are foreigners: suggestions of the enemy, echoes of old wounds, moods masquerading as facts. The renewal discipline is to audit them. Pay attention to your recurring thoughts; write them down if you must. A thought must first be arrested before it can be tried. Try each one against a simple standard: does this thought agree with what God says? If yes, give it residence. If no, escort it to the border in Jesus'' name. You are not the helpless audience of your mind. You are its gatekeeper.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— What recurring thought has been living in you unexamined — claiming to be your own voice?

— Arrest it today: write it down and try it against the Word. Verdict?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Lord, I set up the checkpoint. Every thought will show its papers. Give me alertness to arrest, wisdom to try, and authority to deport — in Jesus'' name. Amen.

_May your border posts stay manned and your inner city stay at peace._'),
  (8, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 10:5; Psalm 19:14'),
  (9, 1, 'scripture', 'Today''s Reading', 'Philippians 4:8', '“Finally, brothers and sisters, whatever is true, whatever is noble, whatever is right, whatever is pure, whatever is lovely, whatever is admirable — if anything is excellent or praiseworthy — think about such things.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Here is why sheer resistance fails: a vacant mind is a contested plot. Jesus told of a house swept clean and left empty — and the evicted spirit returned with seven worse companions (Matthew 12:43–45). Emptiness is not victory; it is a vacancy notice. The Bible''s method is substitution. Every time a wrong thought is evicted, a right one must be installed in its room — this is the Law of Substitution, and Philippians 4:8 is the furniture catalogue: the true, the noble, the pure, the lovely. So prepare your replacements in advance. For every recurring lie you arrested yesterday, write its scriptural replacement today and keep it within reach. The fastest way out of a wrong thought is not fighting it in its own room — it is walking into a better one.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Which arrested thought still has an empty room behind it?

— Write the Philippians 4:8 replacement you will install — word for word.'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, I refuse to leave swept rooms empty. Fill every vacancy with what is true, noble, pure and lovely — and teach me to change rooms quickly. Amen.

_May every evicted lie find its room already occupied by truth._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Philippians 4:8–9; Matthew 12:43–45'),
  (10, 1, 'scripture', 'Today''s Reading', 'Proverbs 4:23', '“Above all else, guard your heart, for everything you do flows from it.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Whatever feeds your mind is farming your mind. Your eyes and ears are gates, and everything passing through them daily is planting something — the news you soak in, the music that loops, the conversations you sit in, the accounts you follow at midnight. Much of what we call weakness of willpower is really carelessness at the gates: we lose the battle at intake and wonder why we lose it at output. What you focus on multiplies — so your inputs are not entertainment; they are agriculture. Take a gate inventory this week, without condemnation and without mercy: What enters daily? What does it plant? Then farm deliberately — unfollow, mute, add, subscribe, choose. Solomon put it “above all else” for a reason: the guarded heart is the source of everything else you are trying to fix.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Which gate is least guarded — eyes, ears, or company?

— Name one input you will remove and one you will plant this week.'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, I station watchmen at my gates. Let what enters my eyes and ears this week be seed I would gladly harvest. Amen.

_May your gates admit only what your future will thank you for._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 4:20–27; Psalm 101:2–3'),
  (11, 1, 'scripture', 'Today''s Reading', 'Joshua 1:8', '“Keep this Book of the Law always on your lips; meditate on it day and night… Then you will be prosperous and successful.”'),
  (11, 2, 'devotional', 'Devotional', NULL, 'Reading passes food across the plate; meditation absorbs it into the bloodstream. This is why one man reads a whole chapter and remains unchanged, while another carries a single verse through his day like a sweet in his mouth — and is transformed. God attached Joshua''s success not to talent or connections but to a meditation habit: day and night, the Word on his lips. Biblical meditation is not emptying the mind but filling it — turning a verse over, questioning it, speaking it, imagining obeying it, until truth stops being information and becomes nourishment. Truth in itself may not free you until it is sequentially arranged and deeply received; one truth builds upon another. So take one verse each morning this week. Read it, think it; read it, ponder it — squeeze its virtue like juice from an orange — and carry it until night.'),
  (11, 3, 'talk', 'Talk it Over', NULL, '— What is the difference in you between weeks you merely read and weeks you meditate?

— Which verse will be today''s "sweet in the mouth"?'),
  (11, 4, 'devotional', 'Pray', NULL, 'God of Joshua, teach me to digest, not just taste. One verse at a time, day and night, let Your Word enter my bloodstream and change my life''s chemistry. Amen.

_May today''s verse still be sweet on your tongue at midnight._'),
  (11, 5, 'reading', 'Go Deeper', NULL, 'Joshua 1:6–9; Psalm 1:1–3'),
  (12, 1, 'scripture', 'Today''s Reading', 'Matthew 13:31–32', '“The kingdom of heaven is like a mustard seed, which a man took and planted in his field. Though it is the smallest of all seeds, yet when it grows, it is the largest of garden plants.”'),
  (12, 2, 'devotional', 'Devotional', NULL, 'Never despise the size of a single thought. One thought — planted, watered, obeyed — can reorganize an entire life. Abraham received one thought under a night sky (“so shall your offspring be”) and it carried him for twenty-five years. One thought from a burning bush emptied Egypt of a nation. The kingdom itself works on mustard-seed mathematics: smallest of seeds, largest of plants. Every enterprise, every reformation, every restored family began as one idea in one mind that refused to let it die. This is also why the enemy contests your thoughts so early — he fights seeds because he fears forests. Somewhere in your recent prayer and reading, God may have already planted the thought your next decade will grow from. Handle your impressions from Him with reverence: write them down, water them in prayer, and act on the first small obedience.'),
  (12, 3, 'talk', 'Talk it Over', NULL, '— What God-planted thought have you been carrying lightly that deserves reverence?

— What is its first small obedience?'),
  (12, 4, 'devotional', 'Pray', NULL, 'Father, make me a careful farmer of holy thoughts. The seed You have planted — I will write it, water it and walk it out until it towers. Amen.

_May one mustard seed of a thought grow into shade for many after you._'),
  (12, 5, 'reading', 'Go Deeper', NULL, 'Matthew 13:31–33; Genesis 15:5–6; Habakkuk 2:2'),
  (13, 1, 'scripture', 'Today''s Reading', 'Proverbs 23:7', '“For as he thinketh in his heart, so is he.”'),
  (13, 2, 'devotional', 'Devotional', NULL, 'Twelve spies toured the same land, tasted the same grapes, measured the same giants. Ten reported: “We seemed like grasshoppers in our own eyes — and we looked the same to them.” Two reported: “We can certainly do it.” Same facts; two mentalities; and each group received exactly the reality its mind had chosen. The grasshopper generation died within reach of the promise; the other mentality entered it. Mark the terrible sequence in their words: in our own eyes first, “to them” second. The world largely takes you at your inner valuation. Your mentality is your reality. But mentalities are not fate — they are habits of thought, and these fifteen days have been rebuilding yours. Where you sized yourself as a grasshopper — in the room, in the market, in the calling — heaven files a different measurement. Adopt heaven''s arithmetic: not “how big is the giant?” but “how big is my God?”'),
  (13, 3, 'talk', 'Talk it Over', NULL, '— In which arena do you still measure yourself a grasshopper?

— What is heaven''s measurement of you in that same arena?'),
  (13, 4, 'devotional', 'Pray', NULL, 'Father, I resign from the grasshopper mentality. Give me the spirit of Caleb — a different spirit — that follows You fully and measures giants against You. Amen.

_May you enter, in your lifetime, every promise the grasshopper mind would have forfeited._'),
  (13, 5, 'reading', 'Go Deeper', NULL, 'Numbers 13:26–14:9; Proverbs 23:7'),
  (14, 1, 'scripture', 'Today''s Reading', 'Ephesians 3:20', '“Now to him who is able to do immeasurably more than all we ask or imagine, according to his power that is at work within us…”'),
  (14, 2, 'devotional', 'Devotional', NULL, 'God built into man a power so great that heaven itself testified of it at Babel: “nothing they plan to do will be impossible for them” (Genesis 11:6). That power is imagination — the mind''s ability to travel into what is not yet seen, survey it, and return to build it. Every invention around you made that journey: first a picture in someone''s mind, then a thing in the world. Like every power, imagination serves whoever employs it. Fear employs it to produce anxiety — vivid films of futures God never wrote. Faith employs it to see what God has promised before it arrives: Abraham counting stars, seeing his descendants. So do not amputate your imagination — sanctify it. Dare to dream again. Let Scripture, not dread, supply its pictures. Imagine yourself obeying, serving, becoming — and note today''s verse: He is able to exceed even that. Your best imagination is still an underestimate.'),
  (14, 3, 'talk', 'Talk it Over', NULL, '— Has your imagination been employed lately by fear or by faith?

— What God-aligned picture of your future will you deliberately hold this week?'),
  (14, 4, 'devotional', 'Pray', NULL, 'Father, I take my imagination back from fear and I hire it out to faith. Fill it with pictures worthy of Your promises — and then exceed them. Amen.

_May your redeemed imagination out-dream your history — and still fall short of what He does._'),
  (14, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 3:14–21; Genesis 15:5'),
  (15, 1, 'scripture', 'Today''s Reading', 'Romans 12:2B', '“Then you will be able to test and approve what God’s will is — his good, pleasing and perfect will.”'),
  (15, 2, 'devotional', 'Devotional', NULL, 'We end where Romans 12:2 ends — at its purpose clause. Why does God renew minds? So that you will be able to test and approve what God''s will is. The renewed mind becomes an instrument of discernment: it recognizes God''s will the way a trained ear recognizes true pitch. This is the practical harvest of your fifteen days: decisions will change. Guidance will feel less like guessing, because a mind soaked in the Word begins to think in the grain of the Author. Confusion loses its grip where renewal has done its work. So take the workshop with you: behold Christ daily; man the checkpoint; substitute, guard, meditate; reverence holy thoughts; refuse grasshopper measurements; dream with a sanctified imagination. When a mind is transformed to a particular level, you are ushered into a different level of life. Keep ascending — from glory to glory.'),
  (15, 3, 'talk', 'Talk it Over', NULL, '— Which of the workshop disciplines will you keep permanently — name three?

— What decision before you now looks different through a renewing mind?'),
  (15, 4, 'devotional', 'Pray', NULL, 'Father, finish what You began: a mind so renewed it recognizes Your will on sight. I keep the disciplines; You keep the transformation — from glory to glory. Amen.

_May the will of God become the easiest thing in the world for your renewed mind to recognize._'),
  (15, 5, 'reading', 'Go Deeper', NULL, 'Romans 12:1–2; Colossians 3:1–2')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- change-to-become (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('change-to-become', 'Change to Become', 'Ten days to break old patterns', 'Everyone wants the harvest of becoming; few want the ploughing of changing. Yet the law of the seed is absolute: nothing becomes without changing. The seed cannot remain a seed and become a tree — it must fall into the ground, break open, and lose its old form for the sake of its greater one. This plan is the ploughing. For ten days we will walk through the four territories where change happens or dies: your mindset, your habits, your character, and your environment. We will meet Caleb, Daniel, Joseph and Abraham — people who changed, and therefore became. Bring one pattern you are tired of. It has an appointment with grace.', 'Growth', 10, 14, 'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
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
  (1, 1, 'scripture', 'Today''s Reading', 'John 12:24', '“Very truly I tell you, unless a kernel of wheat falls to the ground and dies, it remains only a single seed. But if it dies, it produces many seeds.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Jesus spoke today''s verse about Himself — His death and the harvest of His resurrection. It is the deepest pattern in the universe: the way to more is through the breaking open of what is. And because you are in Christ, the pattern is now yours: “If anyone is in Christ, the new creation has come: the old has gone, the new is here!” (2 Corinthians 5:17). The power to change is not your willpower straining against your history; it is His death-and-resurrection life working in you. Many people want the harvest while keeping the seed-coat intact — new results, old self. It cannot be done. So begin this plan with the seed''s surrender: name the old form you have been protecting, and give God permission to break it open. Everything green starts there.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What "seed-coat" — an old identity, comfort, or pattern — have you been protecting?

— What harvest might be waiting on the other side of letting it break?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You fell into the ground and rose a harvest. Work Your pattern in me: I release the old form. Break it open gently, and bring the many seeds. Amen.

_May everything you surrender this week come back as harvest._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'John 12:23–26; 2 Corinthians 5:17'),
  (2, 1, 'scripture', 'Today''s Reading', 'Matthew 4:17', '“From that time on Jesus began to preach, “Repent, for the kingdom of heaven has come near.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'The first word of Jesus'' public preaching was “Repent” — in the Greek, metanoia: change your mind. Before heaven changes a man''s circumstances, it calls for a change of mind, because a man always lives at the level of his thinking. This ordering saves you years. Most of us attack our behaviors directly — the spending, the temper, the procrastination — and lose, because behaviors are fruits and minds are roots. Cut a fruit and it regrows; change a root and the whole tree turns. So ask of the pattern you brought to this plan: what belief keeps it alive? I need this to cope. I will always be like this. This is who we are in our family. Change the sentence underneath, and the pattern above it begins to starve.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— What belief sits at the root of the pattern you want broken?

— What is God''s replacement sentence for that root?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, I bring You roots, not just fruits. Change my mind where the pattern feeds, and let the tree of my behavior turn from its base. Amen.

_May the root change quietly this week — and the branches loudly next season._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Matthew 4:17; Acts 3:19'),
  (3, 1, 'scripture', 'Today''s Reading', 'Numbers 13:30', '“But Caleb… said, “We should go up and take possession of the land, for we can certainly do it.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Ten spies said, “We seemed like grasshoppers in our own eyes.” The defeat happened inside them before any battle was fought — and their inner measurement became a forty-year reality for a whole nation. Caleb saw the same giants with a different mind, and God''s commendation of him is the cure written out: “because my servant Caleb has a different spirit and follows me wholeheartedly, I will bring him into the land” (Numbers 14:24). A different spirit. Wholehearted following. Entrance. Changing to become requires this exchange of measurements. The question is never first “how big is the obstacle?” but “how big is my God — and what has He said?” Practice Caleb''s arithmetic on your current giant today: say aloud, over the specific thing, “We can certainly do it — for the Lord is with us.”'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Where has grasshopper arithmetic been deciding your attempts?

— Apply Caleb''s arithmetic to it — what changes?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, give me the different spirit of Caleb. I trade my measurements for Yours, and I will follow You wholeheartedly into the land You have promised. Amen.

_May a different spirit carry you where old arithmetic never could._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Numbers 13:26–14:9, 24'),
  (4, 1, 'scripture', 'Today''s Reading', 'Daniel 1:8', '“But Daniel resolved not to defile himself…”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'A habit is a decision that has stopped asking for permission. That is its power — for you or against you. The enemy is rarely threatened by your resolutions; he has watched thousands die by February. He is threatened by your habits: the automatic behaviors that no longer consult your feelings. Daniel shows the mechanics of holy habit: he resolved — once, in his heart, before the test — and then enforced one decision daily for decades. By the time crisis came, his knees had a schedule that a king''s decree could not interrupt (Daniel 6:10). So change the pattern at the level where it lives: pick the single small habit that most serves your becoming — the five a.m. prayer, the daily page, the walk, the tithe — decide it once, tonight, and let tomorrow simply obey yesterday''s decision.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Which single habit, kept for a year, would most change your becoming?

— Decide it once, tonight: when, where, how small will it start?'),
  (4, 4, 'devotional', 'Pray', NULL, 'God of Daniel, I make the decision in the quiet, before the noise. One holy habit, decided once, kept daily. Hold me to it until it holds me. Amen.

_May one small habit begun this week still be blessing you in ten years._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Daniel 1:8–16; 6:10'),
  (5, 1, 'scripture', 'Today''s Reading', 'Galatians 6:7, 9', '“Do not be deceived: God cannot be mocked. A man reaps what he sows. …Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'There is an old chain worth engraving on a doorpost: sow a thought, reap an action; sow an action, reap a habit; sow a habit, reap a character; sow a character, reap a destiny. Nothing about your life is random — it is agricultural. This law is your friend, not your judge. It means no faithful small thing is wasted: every hidden discipline, every kind word, every resisted temptation is seed in the ground, and “at the proper time we will reap — if we do not give up.” It also means audits are kind: look at any harvest in your life you dislike, trace it back down the chain, and you will find the seed — changeable, this very week. Your destiny is being decided in your ordinary Tuesdays. Sow them deliberately.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Trace one unwanted harvest down the chain: what seed is at the bottom?

— What seed will you begin sowing on ordinary Tuesdays?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, thank You for a universe where sowing is never wasted. I take up my seed bag with joy — and I will not grow weary before the proper time. Amen.

_May your ordinary Tuesdays quietly assemble an extraordinary destiny._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Galatians 6:7–10; Hosea 10:12'),
  (6, 1, 'scripture', 'Today''s Reading', 'Proverbs 22:29', '“Do you see someone skilled in their work? They will serve before kings…”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Your gift will open doors for you — but only your character will keep you in the rooms your gift opens. Many have been promoted by talent and demoted by character in the same year; the gift got them the platform, and the unchanged self broke it. Joseph is the great study: the gift of dreams took him from prison to palace in a single day, but it was character — tested for years in Potiphar''s house and the dungeon — that kept him there for the rest of his life. “The word of the Lord tested him” (Psalm 105:19). This reframes your waiting seasons entirely: the delay is not God wasting your time; it is God building the pillars that will carry the weight of your becoming. Cooperate with the construction — integrity when unseen, faithfulness when unthanked, purity when unwatched. The room your gift will open is already scheduled. Be the person who can stay in it.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Where is character currently being built in you through testing?

— Which trait — if unchanged — could break the platform your gift is building?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, build in me pillars before You build me platforms. Test me kindly, shape me thoroughly, and make me a man who can stay in the rooms You open. Amen.

_May your character grow one size larger than every room your gift will open._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Genesis 39–41; Psalm 105:17–22'),
  (7, 1, 'scripture', 'Today''s Reading', 'Genesis 12:1', '“The Lord had said to Abram, “Go from your country, your people and your father’s household to the land I will show you.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'God''s first instruction to the father of faith was environmental: go from. The promise was attached to a relocation. Some becomings simply cannot happen at the old address — not because God is limited, but because you are formed by what surrounds you. Seeds do not negotiate with soil; they respond to it. The same seed flourishes in one field and dies in another. Environments water or wither what is planted in you — the voices you sit under, the rooms you frequent, the atmosphere of your daily hours. Not everyone is called to move cities; everyone is called to audit environments. Is there a place, a screen, a circle where your worst self grows effortlessly? And is there a fellowship, a mentor''s shadow, a table where your best self comes alive? Have the courage to leave the one and plant yourself in the other. Obedient feet unlock promised lands.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— In which environment does your worst self grow effortlessly?

— Where does your best self come alive — and how will you be there more?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father of Abraham, I hold my environments with open hands. Say "go from" where You must, and "go to" where You will — my feet are Yours. Amen.

_May your feet find the soil where everything God planted in you flourishes._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Genesis 12:1–4; Psalm 1:1'),
  (8, 1, 'scripture', 'Today''s Reading', '1 Corinthians 15:33; Proverbs 13:20', '“Do not be misled: “Bad company corrupts good character.” … Walk with the wise and become wise, for a companion of fools suffers harm.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'The most powerful environment is not a place — it is people. You are being shaped daily by your closest voices: their expectations calibrate yours, their habits normalize themselves in you, their faith or fear is contagious. Scripture is tender but unbending here: bad company corrupts good character — the verb is present tense and patient; it corrupts slowly, comfortably, like water shaping stone. And the reverse is equally sure: walk with the wise and you become wise. Becoming is partly a matter of walking partners. Elisha left oxen to walk in Elijah''s shadow and inherited a double portion. Choose like that: identify the people whose walk with God you would gladly catch — and get near them. And where a friendship consistently farms your worst self, love faithfully, but reposition lovingly. Your destiny keeps company carefully.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Which voices are currently calibrating you — and toward what?

— Whose shadow should you deliberately walk in this season?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, order my companionships. Give me the humility to walk in wise shadows, the love to bless every person, and the wisdom to guard my inner circle. Amen.

_May every walking partner God assigns you leave you closer to Him._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 13:20; 2 Kings 2:1–14'),
  (9, 1, 'scripture', 'Today''s Reading', 'Philippians 1:6', '“Being confident of this, that he who began a good work in you will carry it on to completion until the day of Christ Jesus.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Real change is a process, and processes have unglamorous middles. There will be days you feel powerfully new and days the old pattern knocks like it still owns a key. Do not panic at the knocking — hearing the knock is not the same as opening the door. Take today''s verse as your covenant of process: He who began is committed to completing. Your transformation has a Guarantor, and He does not abandon sites half-built. When you stumble, the family rule stands: confess quickly, receive mercy quickly, resume quickly (1 John 1:9). Shame delays change; grace accelerates it. Measure yourself by trajectory, not by single days. The seed does not check itself hourly; it stays in the soil and trusts the seasons. You are mid-process — and the Guarantor is pleased with the site.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Where have you been measuring change by single bad days instead of trajectory?

— What does "resume quickly" need to look like in your process?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Faithful Guarantor, I trust the process because I trust the Builder. When I stumble, teach me to resume quickly — and carry Your good work in me to completion. Amen.

_May you feel, on your slowest day, the steady hands of the One completing you._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Philippians 1:3–6; 1 John 1:8–9'),
  (10, 1, 'scripture', 'Today''s Reading', 'Matthew 5:14', '“You are the light of the world. A town built on a hill cannot be hidden.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Your change was never only about you. Be transformed to be a transformer — that is heaven''s economy. The renewed mind renews households; the broken pattern liberates children who will never know what almost passed to them; the changed man becomes an environment in which others'' best selves come alive. Think of who stands downstream of your becoming: a spouse, children, colleagues, a fellowship, a village. Every discipline you have built these ten days is quietly becoming their inheritance. So receive your commissioning: keep changing, and start transmitting. Tell the story of what God is doing in you — testimony is seed in other people''s soil. Invite someone into your new habits. Be, for another person, the environment you once needed. The seed broke open; now comes the harvest of many seeds.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Who stands downstream of your change — name them?

— What is one way you will transmit this week: a testimony, an invitation, an example?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, make my change contagious. Let the pattern that broke in me stay broken for my children, and let my light be a city some weary traveler finds at night. Amen.

_May generations you will never meet eat from the tree of the change you made today._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Matthew 5:13–16; 2 Corinthians 1:3–4')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- new-lenses (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('new-lenses', 'New Lenses', 'Ten days to upgrade your vision', 'Two men stand before the same field: one sees bushes, the other sees a farm. Two women pass the same ruin: one sees rubble, the other sees a school. The difference is never in their eyes — it is in their lenses. And here is the sober law underneath all becoming: you will never rise above the picture you carry of yourself and your future. That is why God, throughout Scripture, keeps interrupting His servants to upgrade their vision — taking Abraham outside to count stars, walking David through lion-and-bear seasons before Goliath. The assignment ahead is always larger than the eyes we came with. For ten days, we go to the Optician. Bring the pictures you have been living from. Some will be confirmed; some will be gloriously replaced.', 'Vision', 10, 15, 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
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
  (1, 1, 'scripture', 'Today''s Reading', 'Luke 24:31', '“Then their eyes were opened and they recognized him…”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Begin with the Optician Himself. Everywhere Jesus went, He opened eyes — blind Bartimaeus on the Jericho road, the man born blind, and on resurrection evening, two discouraged disciples on the Emmaus road whose “eyes were opened and they recognized him.” Note that last case well: their physical eyes had been working all along. What Jesus opened was their seeing. Discouragement had shown them a dead teacher and a finished story; opened eyes showed them a risen Lord and a story just beginning — same facts, new lenses, burning hearts. Every upgrade in this plan flows from Him. So start with the blind man''s honest prayer, which Jesus loved: “Rabbi, I want to see” (Mark 10:51). He has never refused it yet.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— Where might your story look "finished" only because of the lenses you''re wearing?

— Pray Bartimaeus'' prayer over one specific area: "Lord, I want to see."'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, Opener of eyes — my sight is Yours to upgrade. Where discouragement wrote "the end," open my eyes to the risen truth. Rabbi, I want to see. Amen.

_May your heart burn within you as He opens your eyes on the road this week._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Luke 24:13–35; Mark 10:46–52'),
  (2, 1, 'scripture', 'Today''s Reading', 'Proverbs 29:18', '“Where there is no vision, the people perish: but he that keepeth the law, happy is he.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Everything you do is the interpretation of what you see from inside you. Before any action leaves your hands, it passes through the picture room of your inner vision — and the picture, not the circumstance, gives the orders. This is why the enemy fights your imagination before he fights your circumstances: if he can corrupt the picture, he can cancel the performance without a single outward battle. A man who sees himself failing has already rehearsed the failure. And it is why Scripture ties vision to life itself: where there is no vision, people perish — they unravel, drift, scatter. Where vision lives, discipline finds its reason and hope finds its shape. So take inventory today: when you close your eyes and see your future, what plays? That reel, unedited, is your current trajectory. The Optician is ready to edit.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Describe honestly the "reel" that plays when you picture your future.

— Which scene needs the Optician''s edit first?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, I open the picture room to You. Edit the reel — remove what fear filmed, and load the scenes You wrote before I was born. Amen.

_May the pictures you live from be replaced by the pictures He wrote you from._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 29:18; Habakkuk 2:2–3'),
  (3, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:18', '“I pray that the eyes of your heart may be enlightened in order that you may know the hope to which he has called you…”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Sight is a function of the eyes, but vision is a function of the heart. Sight reports what is; vision perceives what God intends. Sight saw a shepherd boy; vision saw a king. Sight saw fishermen; vision saw apostles. Sight sees your present; vision reads your book. This is why Paul prays for “the eyes of your heart” to be enlightened — there is an inner set of eyes, and they can be opened, dimmed, or trained. Vision sets you free from the limitations of what physical eyes can see: the present is never enough for a heart that has seen what God has said. And the freedom is practical — the visionary saves, studies, builds and prays differently, because he has seen where the road goes. Ask today for the Ephesians enlightenment: not new circumstances first, but new eyes first.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— What has "sight" been reporting that "vision" would read differently?

— What do you sense God intends that your eyes cannot yet confirm?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, enlighten the eyes of my heart. Where sight reports limits, let vision read intentions — the hope, the riches, the power of Your calling. Amen.

_May the eyes of your heart out-see the eyes in your head from today._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 1:15–21; 2 Kings 6:15–17'),
  (4, 1, 'scripture', 'Today''s Reading', 'Genesis 13:14–15', '“The Lord said to Abram after Lot had parted from him, “Look around from where you are, to the north and south, to the east and west. All the land that you see I will give to you.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Mark the timing: after Lot had parted from him. Sometimes vision waits for a separation — not from people we hate, but from arrangements that quietly capped our seeing. Only when the land dispute ended did God say, “Now — look around.” Mark also the boundary of the promise: all the land that you see I will give you. God tied the inheritance to the eyesight! The giving was as large as the looking. What Abraham refused to survey, he could not receive. And mark the starting point: “from where you are.” Vision does not require a better location; it requires lifted eyes at this one. So stand exactly where life has you — the same job, the same town, the same season — and look again in every direction, deliberately. Ask God to show you what has been standing in plain sight, waiting for a looker.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Has any "Lot" — an arrangement, a dependency — been quietly capping your vision?

— Look around "from where you are": what is God showing that you never surveyed?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, from where I stand — not where I wish I stood — I lift my eyes north, south, east and west. Show me the inheritance that was waiting for a looker. Amen.

_May your inheritance grow to the size of your lifted eyes._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Genesis 13:5–18'),
  (5, 1, 'scripture', 'Today''s Reading', 'Genesis 15:5', '“He took him outside and said, “Look up at the sky and count the stars — if indeed you can count them.” Then he said to him, “So shall your offspring be.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'The first upgrade was horizontal — land, measurable, surveyable. The second was of another order entirely. God took Abraham outside — out of his tent, out of his own roofline — and turned his face from the horizon to the heavens: count the stars, if you can. Horizontal vision produces measurable dreams; vertical vision produces uncountable ones. Land can be paced out; stars mock arithmetic. And it was under the uncountable sky that Abraham “believed the Lord, and he credited it to him as righteousness” (15:6) — the great faith of history was born at a vision upgrade. Some of us have been faithful with horizontal vision — plans, targets, five-year measures — and God is saying: come outside. Let Him show you a future too large for your instruments. An old man looked at his old body and believed for a nation, because his lenses had been changed under a night sky.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Are your current dreams countable? What would an "uncountable" version look like?

— What "tent" — what roofline of assumption — is God taking you outside of?'),
  (5, 4, 'devotional', 'Pray', NULL, 'God of Abraham, take me outside. Turn my eyes from the horizon to the heavens, and give me a promise too large to count — and faith to believe it. Amen.

_May God take you outside this week — and may you never fit back under the old roof._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Genesis 15:1–6; Romans 4:18–21'),
  (6, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:36', '“Your servant has killed both the lion and the bear; this uncircumcised Philistine will be like one of them.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Where were David''s lenses ground? Not in the valley of Elah — in the shepherd fields, where nobody was watching. Every private victory over lion and bear deposited a certainty: God delivers. By the day of Goliath, the boy was not being brave; he was reading history. This is what your hidden season is actually manufacturing. The unseen faithfulness, the small deliverances, the prayers answered quietly — they are an optics laboratory, calibrating your vision for a public assignment you cannot yet imagine. So keep records like David did. Write down every lion and bear — the fees paid at the deadline, the sickness healed, the door opened. A rehearsed testimony becomes a lens; the man who remembers rightly sees rightly. Your present obscurity is not a delay. It is where your Goliath-lenses are being made.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— List your lions and bears — the private deliverances you have witnessed.

— How does that list change the way today''s challenge looks?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, thank You for the laboratory of my hidden seasons. I will keep the records and rehearse the deliverances — grind my lenses for the valley ahead. Amen.

_May every remembered deliverance sharpen your sight for the next one._'),
  (6, 5, 'reading', 'Go Deeper', NULL, '1 Samuel 17:32–37; Psalm 78:70–72'),
  (7, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:26', '“David asked… “Who is this uncircumcised Philistine that he should defy the armies of the living God?”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'For forty days, an army looked at Goliath and saw the same thing: a giant too big to fight. David looked at the same giant and saw something else entirely: a target too big to miss — an affront to the living God, already as good as fallen. Same valley. Same giant. Two lenses. Saul''s army measured Goliath against themselves and despaired; David measured Goliath against God and volunteered. The measurement decided everything — who trembled, who ran forward, and whose story is told three thousand years later. Your Goliath is real; new lenses do not deny giants, they re-measure them. So run today''s exercise deliberately: take your giant and change the ruler. Not “how big is it next to me?” but “how big is it next to the God of my lions and bears?” Watch the giant shrink to hittable size.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Against what have you been measuring your giant — yourself, or your God?

— Re-measure it aloud: "Who is this ___ next to the living God?"'),
  (7, 4, 'devotional', 'Pray', NULL, 'Living God, I change rulers today. My giant is real — and small beside You. Give me David''s eyes, David''s run, and David''s testimony. Amen.

_May every giant in your valley shrink to the size of a testimony._'),
  (7, 5, 'reading', 'Go Deeper', NULL, '1 Samuel 17:41–50'),
  (8, 1, 'scripture', 'Today''s Reading', '2 Corinthians 9:8', '“And God is able to bless you abundantly, so that in all things at all times, having all that you need, you will abound in every good work.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Here is a discovery that frees visionaries from panic: vision and provision go together — but our provision is never equal to our vision at the moment we receive it. God shows you a wall before He shows you the timber; that gap is not a mistake. It is the space where faith lives. If full provision arrived with the vision, no trust would be required and no testimony would be produced. Instead, provision travels: it meets vision along the road of obedience — Nehemiah received letters and timber after he stood before the king; the widow''s oil multiplied as she poured. So do not audit a God-given vision by your current account balance; audit it by His word. Begin building at the size of today''s supply, and watch supply enlarge at the pace of your obedience. The gap you fear is the very ground where God intends to prove Himself.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Which vision have you shelved because provision wasn''t visible on day one?

— What is the "size of today''s supply" — and what can you build with it now?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Provider God, I stop demanding the timber before the obedience. I will build at today''s size and trust provision to meet vision on the road. Amen.

_May provision keep meeting you on the road, exactly on time, all your life._'),
  (8, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 9:8–11; 2 Kings 4:1–7'),
  (9, 1, 'scripture', 'Today''s Reading', 'Acts 2:17', '“In the last days, God says, I will pour out my Spirit on all people. Your sons and daughters will prophesy, your young men will see visions, your old men will dream dreams.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Somewhere along the road, many people quietly bury their dreams — after the failure, the betrayal, the years of delay — and they call the burial “being realistic.” But hear the promise of the poured-out Spirit: visions for the young, dreams for the old. In God''s economy, dreaming has no retirement age. Abraham was seventy-five at his first promise and a hundred at its fulfillment. Moses'' greatest chapter began at eighty. Heaven specializes in resurrections — and that includes buried dreams. So conduct an exhumation today. What did you once see — before the disappointment reinterpreted it? Take it back to God honestly: some dreams He will resurrect as they were; some He will resurrect transformed, better fitted to your book. But let Him be the one to decide what stays buried. Realism that buries what God authored is not maturity. It is grief wearing a disguise.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— What dream did you bury and label "being realistic"?

— Bring it to God today: resurrect, transform, or release — what is He saying?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Spirit of God, poured out on all flesh — pour out on me. Breathe on the buried dreams; resurrect what You authored, transform what You are redirecting, and give me courage to see again. Amen.

_May old dreams stir in their graves this week — and rise at His voice._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Acts 2:14–21; Joel 2:25–28'),
  (10, 1, 'scripture', 'Today''s Reading', 'Habakkuk 2:2–3', '“Then the Lord replied: “Write down the revelation and make it plain on tablets so that a herald may run with it. For the revelation awaits an appointed time… Though it linger, wait for it; it will certainly come.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Ten days of new lenses now come to a desk. God''s instruction to Habakkuk is your commissioning: write it down. Unwritten vision evaporates; written vision recruits. Write it plainly — so plainly that a runner can carry it: your children, your team, your own tired self on a discouraging Tuesday. Then receive the timing clause as a comfort, not a frustration: the vision awaits an appointed time; though it linger, it will certainly come. Between the writing and the arriving stands the season of faithful running — and you now have the lenses for it: eyes opened by Christ, heart enlightened, giants re-measured, provision trusted, dreams resurrected. So write today — one page: what has God shown you in these ten days? Post it where your eyes will find it daily. What you see is what you become; from today, see it in writing.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Write the vision — one plain page. What did God show you across these ten days?

— Where will you post it, and who else should be able to "run" with it?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, I write what You have shown me, and I will run with patience toward the appointed time. Keep my lenses clean and my feet moving — it will certainly come. Amen.

_May the vision you write today outrun your lifetime and bless your children''s children._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Habakkuk 2:1–3; Proverbs 4:25–27')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- speak-life (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('speak-life', 'Speak Life', 'Ten days to put your words to work', 'You are where you are today, in part, because of what you have been saying about yourself. That is not poetry; it is one of the Bible''s most practical laws: “Death and life are in the power of the tongue, and those who love it will eat its fruits” (Proverbs 18:21). Every day, with every sentence, you are planting seeds — and you will eat their harvest. Whether you realize it or not, you are prophesying your future. The tongue is a small member, but like a ship''s rudder it steers the whole vessel — into the storm, or into safe harbor. For ten days we will retrain the most powerful muscle you own. You will stop using your words to describe your situation, and start using them to change it — the way your Father does.', 'Growth', 10, 16, 'https://images.unsplash.com/photo-1454779132693-e5cd0a216ed3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'speak-life');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Romans 4:17', 'The God Who Speaks Things Into Being'),
  (2, 'Proverbs 18:21', 'You Will Eat Your Words'),
  (3, 'James 3:2', 'You Are Prophesying Your Future'),
  (4, 'James 3:4', 'The Rudder and the Bridle'),
  (5, 'Proverbs 6:2', 'Escape the Snare of Your Own Sentences'),
  (6, '1 Thessalonians 1:3', 'Two Voices Contend for Your Mouth'),
  (7, 'Luke 6:45', 'Fill the Well the Mouth Draws From'),
  (8, 'Psalm 103:20', 'Angels Move at the Word'),
  (9, 'Mark 11:23', 'Speak to the Mountain'),
  (10, 'Isaiah 49:2', 'A Mouth Like a Sharpened Sword')
) AS v(n, ref, title) WHERE p.code = 'speak-life';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'speak-life'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Romans 4:17', '“As it is written: “I have made you a father of many nations.” He is our father in the sight of God, in whom he believed — the God who gives life to the dead and calls into being things that were not.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Begin with your Father''s way of working: He calls into being things that were not. “Let there be light” — and light obeyed a sentence. And notice how He renamed a childless old man “father of many nations” before a single son was born. God speaks in line with the destiny, not the diagnosis. Then came the Son — and words obeyed Him too. He spoke to a storm and it slept; to a fig tree and it withered; to a dead man and Lazarus came out. Never once did Jesus merely describe a situation. He addressed it. You are made in this speaking God''s image, redeemed by His speaking Son. This plan''s premise is simple: it is time your mouth joined the family business.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— Do your words mostly describe your situations or address them?

— What has God "named" over your life that your mouth has not yet agreed with?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Father, You call things that are not as though they were. Lord Jesus, every storm knew Your voice. Teach my tongue the family language — I am ready to speak life. Amen.

_May your mouth learn this week the language your Father has always spoken._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Romans 4:16–21; Genesis 1; Mark 4:39'),
  (2, 1, 'scripture', 'Today''s Reading', 'Proverbs 18:21', '“The tongue has the power of life and death, and those who love it will eat its fruit.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Words are seeds: when you speak something out, you give life to what you have said, and eventually it becomes a reality on your table. You are eating today, in mood and momentum, the fruit of sentences you planted last season. If you want apples, you do not plant thorns. Yet listen to how we plant: I''m always broke. Nothing works for me. I can''t. You cannot talk defeat and expect victory; you cannot talk lack and harvest abundance. If you have a poor mouth, you are going to have a poor life. The same law works gloriously in reverse. Start speaking words of victory — plant the seed of victory and you shall eat its fruit. Your tongue is a farm implement. Today, choose your seed bag.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— What fruit currently on your table can you trace back to your own repeated words?

— What three "victory seeds" will you begin planting daily?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, I take responsibility for my planting. I empty the seed bag of defeat and I fill my mouth with words of life. Give me a harvest worth eating. Amen.

_May your next harvest prove that your seed changed._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 18:20–21; 12:14'),
  (3, 1, 'scripture', 'Today''s Reading', 'James 3:2', '“For we all stumble in many ways. Anyone who is never at fault in what they say is perfect, able to keep their whole body in check.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Whether you realize it or not, you are prophesying your future. Your life will move in the direction of your words — and it has been doing so all along. The person who says “I always fail interviews” walks into the room with that prophecy on their face; the body obeys the sentence. Psychology calls it self-fulfilling expectation. Scripture knew it first: your saying reveals your believing, “for the mouth speaks what the heart is full of” (Luke 6:45) — and then your believing, spoken, steers your becoming. So conduct an audit today: if a stranger wrote down everything you said about yourself this week and read it back as a prophecy — is that the future you want? If not, the correction does not begin at your circumstances. It begins at your mouth.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— What did you prophesy over yourself this week, sentence by sentence?

— Which recurring phrase must be struck from your record?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, forgive the false prophecies I have spoken over my own head. From today, let my mouth agree only with the future You have written for me. Amen.

_May every sentence you speak this week be one you would gladly see fulfilled._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'James 3:1–2; Luke 6:43–45'),
  (4, 1, 'scripture', 'Today''s Reading', 'James 3:4', '“Take ships as an example. Although they are so large and are driven by strong winds, they are steered by a very small rudder wherever the pilot wants to go.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'A ship is directed by its rudder and a horse is controlled by its bridle — and as they are steered, so your tongue steers and directs your destiny. James is amazed at the ratio: something so small, governing something so large. This is wonderful news, not frightening news. It means you do not need to wrestle your whole enormous life into a new direction — you need to gain the rudder. Change the persistent words, and the vessel begins, degree by degree, to turn. The tongue will guide you into a storm, or it will guide you into safe harbor; the rudder is never neutral. So take the helm deliberately: set your course by the Word, speak that course daily, and let the small muscle steer the great ship toward the harbor God has named.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Toward what harbor are your current words steering — honestly?

— What course-setting sentence will you speak each morning this week?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Lord, I take the rudder. I set my course by Your Word, and I will hold it with my words — degree by degree, into safe harbor. Amen.

_May your small rudder steer your great ship into God''s safe harbor._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'James 3:3–6; Psalm 141:3'),
  (5, 1, 'scripture', 'Today''s Reading', 'Proverbs 6:2', '“You are snared by the words of your mouth; you are caught by the words of your mouth.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Sometimes the enemy does not have to defeat us — we defeat ourselves with the words we speak. I could never lead. I''m not the marrying type. My family has always been poor. Each sentence a knot; enough sentences, a snare — and a man wonders who tied him. The trap works quietly: spoken limits become believed limits, believed limits become attempted limits, and attempted limits become your life. Nobody imprisoned you. You testified against yourself, and your future accepted the testimony. But snares of words can be broken by words. Today, revoke specific sentences: name them, renounce them, and replace them aloud. “I withdraw the words ''I could never…'' — I declare instead: I can do all things through Christ who strengthens me.” The mouth that tied the knot can untie it — under a stronger Word than its own.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Which self-spoken sentence has snared you longest?

— Write its revocation and its replacement — then say both aloud.'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, I revoke every sentence I spoke against my own destiny. The snare is cut in Jesus'' name. My mouth now testifies for me, not against me. Amen.

_May every knot your words ever tied come loose today._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 6:2; Matthew 12:36–37'),
  (6, 1, 'scripture', 'Today''s Reading', '1 Thessalonians 1:3', '“We continually remember before our God and Father your work produced by faith, your labor prompted by love, and your endurance inspired by hope in our Lord Jesus Christ.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'In your life there are two voices fighting for your attention: the voice of faith and the voice of defeat. Both offer you scripts all day long, and whichever script your mouth reads aloud gains power. The voice of defeat is fluent in facts: the balance, the diagnosis, the history. But facts are not necessarily truth — you can hold all the facts of a matter while the truth remains with God. The fact was that Lazarus was dead; the truth was that Jesus was on the way. The voice of faith does not deny facts; it outranks them, the way a king''s decree outranks a rumor. So choose your reader: when both scripts arrive tomorrow — and they will — pause, and deliberately read faith''s page aloud. The battle for your future is fought at the microphone of your mouth.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Which voice has been getting your microphone at day''s end?

— Name a "fact" in your life that God''s truth outranks. Say the truth aloud.'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, I give the microphone to the voice of faith. Facts will inform me, but only Your truth will be quoted by my lips. Amen.

_May the voice of faith win every argument held in your mouth this week._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Numbers 13:30–14:9; 2 Corinthians 4:13'),
  (7, 1, 'scripture', 'Today''s Reading', 'Luke 6:45', '“A good man brings good things out of the good stored up in his heart… For the mouth speaks what the heart is full of.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'There is a limit to managing your mouth directly, and Jesus names it: the mouth is a bucket, and it draws from the well of the heart. Squeeze the bucket all you like — under pressure, whatever fills the well is what spills. Your words in a crisis are your heart taking an exam. The reaction you give to a hurting situation reveals what you are truly full of; the ability to keep a level head and sound words under fire is the mark of maturity being formed. So the deepest speech therapy is well-filling: Scripture read aloud, worship in the house, testimonies rehearsed, thanksgiving practiced. Fill the well with life for thirty days and listen to what starts spilling when life squeezes you. Changed springs change streams.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— What spilled out of you at your last squeezing — and what does it reveal about the well?

— What will you pour into the well, daily, for the next thirty days?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Lord, work below my words. Fill the well of my heart with Your Word and Your praise, until even my under-pressure sentences taste of life. Amen.

_May your well be so full of life that pressure can only make you overflow._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Luke 6:43–45; Colossians 3:16'),
  (8, 1, 'scripture', 'Today''s Reading', 'Psalm 103:20', '“Praise the Lord, you his angels, you mighty ones who do his bidding, who obey his word.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Here is a mystery that will dignify every verse you ever quote: angels excel in power, and they move at the sound of God''s word. Not at complaints. Not at commentary. At His word. This is why speaking Scripture is different from speaking positivity. Positive words improve your psychology — a good gift. But God''s Word, spoken, engages heaven''s machinery: “He sent out his word and healed them” (Psalm 107:20); “my word… will not return to me empty” (Isaiah 55:11). So address every situation with the Word of God — family, business, body, destiny. Do not merely talk about the mountain to God; take His Word and speak to the mountain in His name. When your mouth carries His sentences, unseen servants recognize the signature.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Which situation have you discussed endlessly but never addressed with Scripture aloud?

— Find one verse for it today. Speak it over the situation, morning and night.'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, put Your Word in my mouth for every battle I face. As I speak what You have said, let heaven''s mighty ones recognize the signature and move. Amen.

_May your quoted verses be recognized in realms your eyes cannot see._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Psalm 103:20; Isaiah 55:10–11; Acts 20:32'),
  (9, 1, 'scripture', 'Today''s Reading', 'Mark 11:23', '“Truly I tell you, if anyone says to this mountain, ‘Go, throw yourself into the sea,’ and does not doubt in their heart but believes that what they say will happen, it will be done for them.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Read the verse carefully and notice what Jesus did not say. He did not say “pray about the mountain.” He said says to this mountain — speech, aimed at the obstacle, loaded with faith. Prayer petitions God; declaration addresses the problem. The believer needs both. Notice also the ratio in the verse: one “believes in the heart,” but “says” appears with the mountain, the command and the promise. Many believers have faith locked in their hearts that has never once been issued through their mouths — an army never deployed. So identify your mountain today — the obstacle, not the people near it — and speak to it by name, in the name of Jesus, with the Word of God. It has been listening to your fear for years. Let it finally hear your faith.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Have you been talking about your mountain or to it?

— Write the exact sentence of command you will speak — then speak it.'),
  (9, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, I believe — and now I say. To every mountain standing between me and the life You wrote: move, in Jesus'' name. I will not doubt in my heart. Amen.

_May the mountains that heard your fear now hear your faith — and move._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Mark 11:20–24; Zechariah 4:6–7'),
  (10, 1, 'scripture', 'Today''s Reading', 'Isaiah 49:2', '“He made my mouth like a sharpened sword, in the shadow of his hand he hid me; he made me into a polished arrow and concealed me in his quiver.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Here is your commissioning image: God fashions servants whose mouths are sharpened swords and polished arrows — words with edge, direction and appointed targets. Ten days of training were not for decoration; heaven arms mouths it can trust. But a sword this sharp needs one final safeguard: “Out of the same mouth come praise and cursing. My brothers and sisters, this should not be” (James 3:9–10). The tongue that blesses God must not curse His image-bearers — including the one in your mirror. Bless your children, your spouse, your colleagues, yourself; prophesy good over people, not evil. So go now with the family language on your lips: “I believed; therefore I have spoken” (2 Corinthians 4:13). Speak life at home, over your work, into your body, toward your destiny — and stay in the quiver, ready for the moments God aims you.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Over whom will you deliberately speak blessing this week — by name?

— What daily declaration set will you carry from this plan for life?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, make my mouth a sharpened sword in Your hand — never against Your children, always for Your purposes. I will speak life all the days written in my book. Amen.

_May your words be swords in God''s hand and springs in people''s deserts — all your days._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Isaiah 49:1–3; James 3:9–12; Numbers 6:24–26')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
DELETE FROM reading_plans WHERE code IN ('why-am-i-here', 'ask-better', 'the-renewed-mind', 'change-to-become', 'new-lenses', 'speak-life');
