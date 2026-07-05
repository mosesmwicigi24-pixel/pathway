-- Why Am I Here?: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
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
  (1, 1, 'scripture', 'Today''s Reading', 'John 18:37', $dev$“You say that I am a king. In fact, the reason I was born and came into the world is to testify to the truth.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Standing on trial for His life, Jesus said something no anxiety could shake: the reason I was born. He knew it. He had always known it — at twelve in the temple (“I must be about my Father's business”), at the peak of fame (“let us go somewhere else — that is why I have come”), and at the end (“I have finished the work you gave me”).

A man who knows why he was born cannot be scattered by applause or dismantled by opposition. Purpose was Christ's spine — and here is the gospel of it: in Him, purpose becomes yours too. “We are God's workmanship, created in Christ Jesus to do good works, which God prepared in advance” (Ephesians 2:10).

The works are prepared. The plan of these ten days is simply to find what already has your name on it.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Could you complete the sentence "the reason I was born is…"? What comes out?

— What would change in your week if that sentence were settled?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You knew why You were born — and You hold the reason I was. Walk me through these ten days until my purpose moves from mystery to assignment. Amen.

_May the question that kept you awake become the assignment that wakes you up._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$John 18:33–37; Ephesians 2:8–10$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Isaiah 43:6–7', $dev$“Bring my sons from afar and my daughters from the ends of the earth — everyone who is called by my name, whom I created for my glory, whom I formed and made.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Before purpose gets specific, it gets simple: you were created for the glory of God. That is the headline over every human life — created, formed and made for His glory.

This is not a small answer; it is a liberating one. It means your purpose is not hiding in some distant achievement you may never reach. You can fulfill the deepest layer of your purpose today — in how you work, love, speak and worship. “Whether you eat or drink or whatever you do, do it all for the glory of God” (1 Corinthians 10:31).

Everything else this plan uncovers — your assignment, your gifts, your timing — sits on this foundation. Purpose is not first a task. It is first a direction: a life angled toward the pleasure of the One who made it.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— If glory to God is the headline, what would today look like lived under it?

— Where have you been seeking a purpose that impresses people more than one that honors God?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, before I ask what to do, I settle who it is for. I was created for Your glory — let every ordinary hour of this day be angled toward You. Amen.

_May your most ordinary hours begin to shine with the glory they were made for._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 43:1–7; 1 Corinthians 10:31$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Jeremiah 1:5', $dev$“Before I formed you in the womb I knew you, before you were born I set you apart; I appointed you as a prophet to the nations.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Notice the order of Jeremiah's calling: known, set apart, appointed — all before birth. He did not arrive on earth and then look around for something useful to do. The assignment predated the arrival. He was sent, not dropped.

So were you. Before the beginning of time, God established the times when you would live and set apart the work, the mandate, the assignment you would need to accomplish. Your birth was heaven deploying a solution to problems it had already scheduled you to meet.

This changes the search entirely: you are not inventing a purpose out of your preferences. You are discovering an appointment that was made without your permission — and it is better than anything you would have designed.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you live like someone dropped into the world, or someone sent into it?

— What problems around you stir you as though they were scheduled for you?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, I was known, set apart and appointed before I was born. Open the sealed orders. I am ready to discover what You sent me here to do. Amen.

_May you feel today the dignity of a sent person walking an appointed earth._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Jeremiah 1:4–10; Psalm 139:16$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Colossians 3:23', $dev$“Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Many people think purpose requires leaving their job for a pulpit. Hear this clearly: purpose is not a change of address; it is a change of orientation. The farm, the classroom, the clinic, the shop — any honest work becomes a sanctuary the moment it is done as for the Lord.

If a man is called to be a street sweeper, let him sweep streets the way Michelangelo painted — that is how a calling behaves in ordinary clothes. Daniel served a government; Lydia sold cloth; Joseph administered grain. Scripture's purposeful people were mostly not clergy.

So do not despise your current desk — it may be the very ground of your assignment. Work done with all your heart, for His eyes, is worship with its sleeves rolled up.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— How would tomorrow's work change if the Lord were your only supervisor?

— What excellence have you been withholding because "it's just a job"?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Lord, I re-orient my work: same desk, new Master. Receive my labor this week as worship, and let my excellence preach where my words cannot. Amen.

_May your workplace quietly become an altar this week._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Colossians 3:22–24; Proverbs 22:29$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Nehemiah 1:3–4', $dev$“They said to me, “Those who survived… are in great trouble and disgrace. The wall of Jerusalem is broken down.” When I heard these things, I sat down and wept.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Nehemiah was a cupbearer, comfortable in a palace — until a report about broken walls broke his heart. He wept, fasted, prayed. That weight had an assignment inside it: the man who cried over the walls became the man who rebuilt them.

Here is one of purpose's most reliable compasses: your destiny is often birthed from your burden. Not every sad story moves you — but some particular brokenness does: the fatherless, the addicted, the unschooled, the church's coldness, a community's poverty. That specific ache is not weakness. It is a map.

What makes you weep or makes you righteously angry is worth interrogating in prayer. God often addresses His repairs to the hearts that feel the damage most.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— What brokenness moves you more than it seems to move others?

— If your burden had an assignment inside it, what might it be?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I stop apologizing for the ache. Show me the assignment inside my burden, and give me Nehemiah's courage to move from weeping to building. Amen.

_May your deepest ache reveal itself as your clearest assignment._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Nehemiah 1:1–11; Judges 6:11–14$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Nehemiah 2:8', $dev$“And the king granted them to me, because the good hand of my God was upon me.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Watch Nehemiah's burden become a mission, and you will see three confirmations that still mark a true purpose. Passion: when God calls you to something, He plants a holy restlessness for it — Nehemiah could not rest while the walls lay in ruins. When God calls you to do something, go and do it.

Possibilities: God opens doors you did not push. The king granted leave, letters and timber — opportunity moved toward the assignment. And when a door refuses to move, ask the discerning question: is it not yet the time, or am I not the person for it?

Provision: resources follow the call (Nehemiah 2:7–9). Where God guides, He provides. Under these three, a wall that had shamed a nation for a century was finished in fifty-two days.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Where do passion, possibility and provision currently overlap in your life?

— Which of the three are you waiting on — and what would faithful waiting look like?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, confirm my path the Nehemiah way: plant the passion, open the possibilities, send the provision. And when all three align, give me speed to build. Amen.

_May doors you never pushed begin to move for you._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Nehemiah 2:1–9; 6:15–16$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Ecclesiastes 3:1', $dev$“There is a time for everything, and a season for every activity under the heavens.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$In purpose, timing is very important — don't eat your dinner in the morning. A right assignment forced into the wrong season produces the same result as a wrong assignment: frustration. The mango ripened in its season is sweeter than the one forced ripe in a sack.

David was anointed king years before he wore a crown — and he did not force the throne, even when Saul was within a spear's reach of being removed. He let God's timing do the promoting, and his kingdom stood.

Purpose therefore requires two disciplines, not one: knowing what you are called to, and discerning when. Ask God not only “what is my assignment?” but “what does this season require?” Preparation seasons are not delays; they are dinner cooking.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where might you be forcing dinner in the morning — right call, wrong hour?

— What does your current season actually require of you: building, waiting, learning, or launching?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord of seasons, save me from harvesting early and from sleeping late. Name my current season, and give me the grace to do exactly what it requires. Amen.

_May every purpose in your life ripen sweetly in its season._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Ecclesiastes 3:1–11; 1 Samuel 26:9–11$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Mark 10:45', $dev$“For even the Son of Man did not come to be served, but to serve, and to give his life as a ransom for many.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Many people who reached their destiny first learned to be servants. Joseph served in Potiphar's house and in prison before he governed Egypt. Joshua served Moses; Elisha poured water on Elijah's hands; David served Saul's household with a harp. Serving is not the delay of destiny — it is the discovery of it.

Why? Because your destiny is discovered when you serve. Service puts your gifts in motion where you can finally observe them; it grows you in another man's vineyard until God plants you in your own; and it kills the pride that ruins purpose at the root.

If you cannot yet see your purpose, do not stand still squinting at the horizon. Find a place to serve — this week — and watch what rises in your hands.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Where are you currently serving with no title and no spotlight?

— What have you noticed rising in your hands when you serve others?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You came to serve — make me like You. Lead me to a vineyard where I can pour water on another's hands, and reveal my purpose in the pouring. Amen.

_May a towel in your hands do what a title never could._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 10:42–45; 2 Kings 3:11; Luke 16:12$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Psalm 138:8', $dev$“The Lord will vindicate me; your love, Lord, endures forever — do not abandon the works of your hands.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Something happens to worship when purpose awakens: it finds its voice. When you put praise into your purpose, it releases the power that changes life. A person who knows they are on assignment thanks God differently — the singing gets personal.

And the reverse is also true: gratitude keeps purpose healthy. Purpose without praise curdles into ambition; the mission becomes about you. Daily thanksgiving keeps the assignment in its Owner's name.

Today's verse is the worker's anthem: the Lord will fulfill his purpose for me. Not “I will grind my purpose into existence” — He fulfills; you cooperate. So build the habit now: every step of progress, praise; every closed door, praise; every small beginning, praise. Purpose walks farthest on grateful legs.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Has your pursuit of purpose been fueled more by ambition or by gratitude lately?

— What progress — however small — deserves your praise today?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, I put praise inside my purpose. Thank You for what You have already done and for what is already written. Fulfill Your purpose for me — I will thank You at every mile. Amen.

_May gratitude carry your purpose farther than ambition ever could._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 138; Philippians 1:6$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'John 17:4', $dev$“I have brought you glory on earth by finishing the work you gave me to do.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Here is how Jesus measured a completed life — not by doing all possible work, but by finishing the work you gave me. There were still sick people in Israel when He prayed this; still villages unvisited. Purpose is not the exhaustion of every need around you. It is the completion of the specific lines written in your book.

And of David the Scripture records the epitaph every becomer should covet: “when David had served God's purpose in his own generation, he fell asleep” (Acts 13:36). His own generation — the only one he was given.

So go now with the compass of these ten days: made for His glory, sent with an assignment, guided by burden, gifts, seasons and service. You do not need to do everything. You need to finish yours.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Write your own John 17:4 sentence: what work must you finish before you sleep?

— What is the very next faithful step toward it — this week?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, one prayer for the rest of my days: let me finish the work You gave me. Not everyone's work — mine. And when I sleep, let it be said I served Your purpose in my generation. Amen.

_May you live so purposefully that your last prayer can be "I have finished the work."_$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$John 17:1–4; Acts 13:36; 2 Timothy 4:7$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
