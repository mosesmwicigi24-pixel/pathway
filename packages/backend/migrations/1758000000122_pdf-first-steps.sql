-- First Steps: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'first-steps');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, '2 Corinthians 5:17', 'What Just Happened to You'),
  (2, 'Matthew 6:9', 'Learning to Talk With God'),
  (3, '1 Peter 2:2', 'Food for the New Life'),
  (4, 'Hebrews 10:24–25', 'You Need a Family'),
  (5, 'Romans 6:4', 'Baptism: Your Public Yes'),
  (6, 'John 14:16–17', 'The Helper Within'),
  (7, 'Acts 2:42', 'Walking It Out')
) AS v(n, ref, title) WHERE p.code = 'first-steps';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'first-steps'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', '2 Corinthians 5:17', $dev$“Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,                 $dev$When you believed in Jesus, something happened that you could not see but heaven witnessed: you were made new. Not improved — new. Your sins were forgiven completely, carried by Christ at the cross (1 Peter 2:24). Your name was written in heaven. The Spirit of God took residence in you.

You may not feel dramatically different this morning, and that is perfectly fine. A newborn does not feel born; it simply is. Your new life rests on what God did, not on what you feel hour to hour.

So begin your walk with this certainty: “to all who received him… he gave the right to become children of God” (John 1:12). You received Him. You are His child. That is now the most true thing about you.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— What led you to say yes to Jesus?

— What is one question about your new life you hope this week answers?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, thank You for making me new. I may not understand everything yet, but I know this: I am Yours. Teach me to walk, one step at a time. Amen.

_May the newness in you feel a little more real each morning this week._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,                 $dev$2 Corinthians 5:14–21; John 1:12–13$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Matthew 6:9',        $dev$“This, then, is how you should pray: ‘Our Father in heaven, hallowed be your name…’”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,                 $dev$Prayer is simply talking with the God who is now your Father — and He is easier to talk to than anyone you have ever met. You need no special language, posture or vocabulary. The disciples asked Jesus to teach them, and He gave a pattern: honor the Father, welcome His kingdom, ask for daily needs, ask forgiveness and forgive others, ask for protection.

Start small and honest: five minutes in the morning. Speak as you speak — He has heard every kind of accent and every kind of grammar, and He treasures yours.

And prayer is two-way: leave quiet space. God speaks — most often through His Word, through peace, through a growing conviction. You will learn His voice the way a child learns a parent's: by time together.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— When today will you take your five minutes?

— What is the most honest thing you need to say to God right now?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,                 $dev$Our Father in heaven, teach me to pray — simply, honestly, daily. Thank You that You want conversation, not performance. Here is my voice; I am learning Yours. Amen.

_May prayer become as natural to you as breathing, and as sweet as friendship._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Matthew 6:5–15; Luke 11:1–13$dev$),
  (3, 1, 'scripture',  'Today''s Reading', '1 Peter 2:2',        $dev$“Like newborn babies, crave pure spiritual milk, so that by it you may grow up in your salvation.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,                 $dev$Every newborn needs food, and your new life feeds on the Word of God. Jesus said man shall not live on bread alone “but on every word that comes from the mouth of God” (Matthew 4:4). The Bible is not a rulebook to fear; it is a table to eat from — the word we preach and read is from God Himself.

Start where the story of Jesus is clearest: the Gospel of John. One chapter a day, or even half. Read slowly. Underline what touches you. Ask two questions of every passage: what does this show me about God? What is one thing I can do about it today?

Do not worry about the parts you don't yet understand — feed on the parts you do. If you read today, it will show tomorrow.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— When and where will your daily reading happen?

— What did you read today that you can act on before sunset?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, give me an appetite for Your Word. As I open the Gospel of John this week, open my understanding — and let what I read begin to show in how I live. Amen.

_May the Word taste sweeter to you every day you eat it._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,                 $dev$John 1; Psalm 1:1–3$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Hebrews 10:24–25',   $dev$“And let us consider how we may spur one another on toward love and good deeds, not giving up meeting together…”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,                 $dev$A coal that stays in the fire glows; a coal set apart cools. It is not weakness that makes you need other believers — it is design. You were born again into a family, and no child thrives raised alone.

Find a Bible-teaching church and plant yourself. Come with expectation, not perfection-hunting — every church is a family of the forgiven, still under construction. Join a smaller group if one exists; faith grows fastest at close range, where people know your name and your week.

And receive this early warning kindly: isolation is where discouragement does its best work. When you least feel like gathering is usually when you most need to. Stay in the fire, and you will stay warm.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— What church will you attend this Sunday — decided now, not Saturday night?

— Who is one believer you can ask to walk with you as an older brother or sister in the faith?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, lead me to the family You have prepared for me. Give me the humility to be known and the courage to belong. Keep me in the fire. Amen.

_May you find a spiritual family that feels like a homecoming._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Hebrews 10:19–25; Acts 2:42–47$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Romans 6:4',         $dev$“We were therefore buried with him through baptism into death in order that, just as Christ was raised from the dead through the glory of the Father, we too may live a new life.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,                 $dev$Baptism is the wedding ring of your new life — the outward sign of an inward covenant. Going under the water pictures your old life buried with Christ; rising out of it pictures your new life raised with Him. It does not save you — Christ has done that — but it announces publicly whose you now are.

Jesus Himself was baptized, and heaven tore open with the Father's delight: “This is my Son, whom I love.” He then told His followers to baptize every new disciple (Matthew 28:19). It is your first act of glad obedience, and obedience is how love speaks.

Speak to your pastor about it this month. Do not wait to feel worthy — the water is not for the worthy; it is for the willing.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— What holds you back from baptism — and is it a reason or a fear?

— Who would you want witnessing your public yes?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,                 $dev$Lord Jesus, I want to follow You into the water. Arrange my baptism, and let my going under and rising up preach Your death and resurrection to everyone watching. Amen.

_May the day of your baptism become one of the sweetest memories of your life._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Romans 6:1–11; Matthew 3:13–17; Acts 8:35–39$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'John 14:16–17',      $dev$“And I will ask the Father, and he will give you another advocate to help you and be with you forever — the Spirit of truth… he lives with you and will be in you.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,                 $dev$You have not been left to manage the Christian life by willpower — that would fail by Thursday. When you believed, the Holy Spirit — God Himself — came to live in you. Jesus called Him the Helper: comforter in sorrow, teacher of truth, strength in temptation, guide in decisions.

This changes how you grow. You do not imitate Jesus from a distance; you cooperate with His Spirit from within. When you feel a gentle conviction about something wrong, that is Him — respond quickly and kindly. When a verse suddenly glows with meaning, that is Him teaching.

Ask for His filling daily (Luke 11:13). By desiring and receiving the Spirit, we receive not only a Helper but the unraveling of the deep things of God.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— Where do you most need a Helper right now — comfort, clarity, or strength?

— Have you sensed His gentle conviction or teaching already? How did you respond?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,                 $dev$Holy Spirit, welcome — truly welcome — into every room of my life. Fill me today. Teach me, comfort me, strengthen me, and make Jesus real to me from the inside. Amen.

_May you feel the Helper closer than your own heartbeat this week._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,                 $dev$John 14:15–27; Galatians 5:22–25$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'Acts 2:42',          $dev$“They devoted themselves to the apostles’ teaching and to fellowship, to the breaking of bread and to prayer.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,                 $dev$The first believers grew by four devotions: the Word, the family, worship at the table, and prayer. Twenty centuries later, the recipe is unchanged — and this week you have tasted all four. Now they become your walk: not a sprint of feelings, but a path of small faithful steps.

Expect real life: some days the Word will burn, other days it will feel like bread without butter. Feelings come and go; the covenant stays. When you stumble — and every child learning to walk does — remember the family rule: “If we confess our sins, he is faithful and just and will forgive us” (1 John 1:9). Get up quickly; the Father's hand is already extended.

And begin telling your story. You do not need theology to testify — “I once was blind, but now I see” has been enough for two thousand years. Your journey of becoming has begun.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— Which of the four devotions will need the most intention from you?

— Who is the first person you will tell about what has happened to you?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, I set my feet on the path: Your Word, Your family, Your table, Your ear. Hold my hand when I stumble, and make my small story a doorway for someone else. I am walking. Amen.

_May every step of your new walk be steadied by the God who will finish what He began in you._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Acts 2:41–47; 1 John 1:5–9$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
