-- Seed 7 standalone study plans from 'The Power to Become' (Moses Mwicigi):
-- First Steps (7d) + six 10-day plans. Each day: key verse (scripture) ->
-- Devotional -> Talk it Over (Reflect) -> Pray (+blessing) -> Go Deeper.
-- No videos: the video segment row is simply absent. Re-runnable: plans
-- upsert by code and days are cleanly reseeded.

-- Up Migration

-- ====================================================================
-- first-steps (7 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('first-steps', 'First Steps', 'Seven days for the new believer', 'You said yes to Jesus — perhaps recently, perhaps quietly, perhaps with tears. And now a very honest question follows: what happens next? This plan is your first week''s walk. No religious jargon, no assumptions — just the essentials, one gentle day at a time. In seven days you will discover what actually happened when you believed, how to talk with God, how to feed your new life, why you need a spiritual family, what baptism means, and who the Helper is that now lives within you. Welcome to the family. Heaven threw a party the day you turned (Luke 15:10) — this week, we unwrap the gifts.', 'Foundations', 7, 4, 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
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
  (1, 1, 'scripture', 'Today''s Reading', '2 Corinthians 5:17', '“Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'When you believed in Jesus, something happened that you could not see but heaven witnessed: you were made new. Not improved — new. Your sins were forgiven completely, carried by Christ at the cross (1 Peter 2:24). Your name was written in heaven. The Spirit of God took residence in you. You may not feel dramatically different this morning, and that is perfectly fine. A newborn does not feel born; it simply is. Your new life rests on what God did, not on what you feel hour to hour. So begin your walk with this certainty: “to all who received him… he gave the right to become children of God” (John 1:12). You received Him. You are His child. That is now the most true thing about you.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What led you to say yes to Jesus?

— What is one question about your new life you hope this week answers?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Father, thank You for making me new. I may not understand everything yet, but I know this: I am Yours. Teach me to walk, one step at a time. Amen.

_May the newness in you feel a little more real each morning this week._'),
  (1, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 5:14–21; John 1:12–13'),
  (2, 1, 'scripture', 'Today''s Reading', 'Matthew 6:9', '“This, then, is how you should pray: “Our Father in heaven, hallowed be your name…”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Prayer is simply talking with the God who is now your Father — and He is easier to talk to than anyone you have ever met. You need no special language, posture or vocabulary. The disciples asked Jesus to teach them, and He gave a pattern: honor the Father, welcome His kingdom, ask for daily needs, ask forgiveness and forgive others, ask for protection. Start small and honest: five minutes in the morning. Speak as you speak — He has heard every kind of accent and every kind of grammar, and He treasures yours. And prayer is two-way: leave quiet space. God speaks — most often through His Word, through peace, through a growing conviction. You will learn His voice the way a child learns a parent''s: by time together.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— When today will you take your five minutes?

— What is the most honest thing you need to say to God right now?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Our Father in heaven, teach me to pray — simply, honestly, daily. Thank You that You want conversation, not performance. Here is my voice; I am learning Yours. Amen.

_May prayer become as natural to you as breathing, and as sweet as friendship._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Matthew 6:5–15; Luke 11:1–13'),
  (3, 1, 'scripture', 'Today''s Reading', '1 Peter 2:2', '“Like newborn babies, crave pure spiritual milk, so that by it you may grow up in your salvation.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Every newborn needs food, and your new life feeds on the Word of God. Jesus said man shall not live on bread alone “but on every word that comes from the mouth of God” (Matthew 4:4). The Bible is not a rulebook to fear; it is a table to eat from — the word we preach and read is from God Himself. Start where the story of Jesus is clearest: the Gospel of John. One chapter a day, or even half. Read slowly. Underline what touches you. Ask two questions of every passage: what does this show me about God? What is one thing I can do about it today? Do not worry about the parts you don''t yet understand — feed on the parts you do. If you read today, it will show tomorrow.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— When and where will your daily reading happen?

— What did you read today that you can act on before sunset?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, give me an appetite for Your Word. As I open the Gospel of John this week, open my understanding — and let what I read begin to show in how I live. Amen.

_May the Word taste sweeter to you every day you eat it._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'John 1; Psalm 1:1–3'),
  (4, 1, 'scripture', 'Today''s Reading', 'Hebrews 10:24–25', '“And let us consider how we may spur one another on toward love and good deeds, not giving up meeting together…”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'A coal that stays in the fire glows; a coal set apart cools. It is not weakness that makes you need other believers — it is design. You were born again into a family, and no child thrives raised alone. Find a Bible-teaching church and plant yourself. Come with expectation, not perfection-hunting — every church is a family of the forgiven, still under construction. Join a smaller group if one exists; faith grows fastest at close range, where people know your name and your week. And receive this early warning kindly: isolation is where discouragement does its best work. When you least feel like gathering is usually when you most need to. Stay in the fire, and you will stay warm.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— What church will you attend this Sunday — decided now, not Saturday night?

— Who is one believer you can ask to walk with you as an older brother or sister in the faith?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, lead me to the family You have prepared for me. Give me the humility to be known and the courage to belong. Keep me in the fire. Amen.

_May you find a spiritual family that feels like a homecoming._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Hebrews 10:19–25; Acts 2:42–47'),
  (5, 1, 'scripture', 'Today''s Reading', 'Romans 6:4', '“We were therefore buried with him through baptism into death in order that, just as Christ was raised from the dead through the glory of the Father, we too may live a new life.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Baptism is the wedding ring of your new life — the outward sign of an inward covenant. Going under the water pictures your old life buried with Christ; rising out of it pictures your new life raised with Him. It does not save you — Christ has done that — but it announces publicly whose you now are. Jesus Himself was baptized, and heaven tore open with the Father''s delight: “This is my Son, whom I love.” He then told His followers to baptize every new disciple (Matthew 28:19). It is your first act of glad obedience, and obedience is how love speaks. Speak to your pastor about it this month. Do not wait to feel worthy — the water is not for the worthy; it is for the willing.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— What holds you back from baptism — and is it a reason or a fear?

— Who would you want witnessing your public yes?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, I want to follow You into the water. Arrange my baptism, and let my going under and rising up preach Your death and resurrection to everyone watching. Amen.

_May the day of your baptism become one of the sweetest memories of your life._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Romans 6:1–11; Matthew 3:13–17; Acts 8:35–39'),
  (6, 1, 'scripture', 'Today''s Reading', 'John 14:16–17', '“And I will ask the Father, and he will give you another advocate to help you and be with you forever — the Spirit of truth… he lives with you and will be in you.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'You have not been left to manage the Christian life by willpower — that would fail by Thursday. When you believed, the Holy Spirit — God Himself — came to live in you. Jesus called Him the Helper: comforter in sorrow, teacher of truth, strength in temptation, guide in decisions. This changes how you grow. You do not imitate Jesus from a distance; you cooperate with His Spirit from within. When you feel a gentle conviction about something wrong, that is Him — respond quickly and kindly. When a verse suddenly glows with meaning, that is Him teaching. Ask for His filling daily (Luke 11:13). By desiring and receiving the Spirit, we receive not only a Helper but the unraveling of the deep things of God.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Where do you most need a Helper right now — comfort, clarity, or strength?

— Have you sensed His gentle conviction or teaching already? How did you respond?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Holy Spirit, welcome — truly welcome — into every room of my life. Fill me today. Teach me, comfort me, strengthen me, and make Jesus real to me from the inside. Amen.

_May you feel the Helper closer than your own heartbeat this week._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'John 14:15–27; Galatians 5:22–25'),
  (7, 1, 'scripture', 'Today''s Reading', 'Acts 2:42', '“They devoted themselves to the apostles’ teaching and to fellowship, to the breaking of bread and to prayer.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'The first believers grew by four devotions: the Word, the family, worship at the table, and prayer. Twenty centuries later, the recipe is unchanged — and this week you have tasted all four. Now they become your walk: not a sprint of feelings, but a path of small faithful steps. Expect real life: some days the Word will burn, other days it will feel like bread without butter. Feelings come and go; the covenant stays. When you stumble — and every child learning to walk does — remember the family rule: “If we confess our sins, he is faithful and just and will forgive us” (1 John 1:9). Get up quickly; the Father''s hand is already extended. And begin telling your story. You do not need theology to testify — “I once was blind, but now I see” has been enough for two thousand years. Your journey of becoming has begun.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Which of the four devotions will need the most intention from you?

— Who is the first person you will tell about what has happened to you?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, I set my feet on the path: Your Word, Your family, Your table, Your ear. Hold my hand when I stumble, and make my small story a doorway for someone else. I am walking. Amen.

_May every step of your new walk be steadied by the God who will finish what He began in you._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Acts 2:41–47; 1 John 1:5–9')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- who-am-i (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('who-am-i', 'Who Am I?', 'Ten days to an unshakable identity', 'It is strange how easily we describe other people — their strengths, their flaws, their potential — and how we go silent when the question turns on us. Have you ever stood at the mirror and asked the face looking back: who am I? And wondered where the dreams, the visions and the enthusiasm of five years ago have gone? You are not alone in that mirror. This plan walks with you for ten days through the question every human being must answer, because everything else in your life — your confidence, your choices, your relationships, your destiny — is built on your answer to it. We will not look for the answer in personality tests, in your achievements, or in other people''s opinions. We will look where the answer was written first: in the Word of the God who made you. Ten days. One question. An answer that cannot be shaken.', 'Identity', 10, 5, 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'who-am-i');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Psalm 8:4', 'The Stranger in the Mirror'),
  (2, 'Luke 12:15', 'Your Success Is Lying to You'),
  (3, 'Galatians 1:10', 'The Celebrity Trap'),
  (4, 'Acts 17:26', 'Made From One Blood'),
  (5, '2 Corinthians 3:18', 'The Perfect Mirror'),
  (6, 'John 1:12', 'A Child of the Father'),
  (7, 'John 15:15', 'A Friend of Jesus'),
  (8, 'Judges 5:20', 'Men Have Ranks in the Spirit'),
  (9, 'Romans 8:1', 'Say Who You Are'),
  (10, 'Ephesians 2:10', 'Named for a Purpose')
) AS v(n, ref, title) WHERE p.code = 'who-am-i';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'who-am-i'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Psalm 8:4', '“What is mankind that you are mindful of them, human beings that you care for them?”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'It is much easier to define other people than to define ourselves. Ask someone to describe their friend and words flow freely; ask them to describe themselves and the room goes quiet. Psychologists call it self-opacity — we are the one person we never see from the outside. The Psalmist felt it too, standing under a night sky: what is mankind? Here is where this journey begins: the confusion you feel about yourself is not evidence that you are nothing. It is evidence that you are deep — deep enough that only your Maker holds the full description. A product is never explained by the shelf it sits on; it is explained by its manufacturer. For the next ten days, stop asking the mirror. Start asking the Maker.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— If a stranger asked you "who are you?" — and your job, family roles and achievements were off-limits — what would you say?

— When did you last feel truly sure of who you are? What changed?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Father, I bring You the question I have carried silently for years: who am I? I have asked mirrors, people and achievements, and their answers did not hold. For the next ten days, I am asking You. Speak, Lord. Amen.'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Psalm 8; Psalm 139:1–6'),
  (2, 1, 'scripture', 'Today''s Reading', 'Luke 12:15', '“Watch out! Be on your guard against all kinds of greed; life does not consist in an abundance of possessions.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Some people never discover who they are because failure blinds them. But hear a stranger warning: many more are blinded by success. When applause is loud enough, you stop asking questions. Why examine your identity when your results keep telling you that you are fine? Yet you can be performing better than everyone around you and still be operating far below your own potential. That is not success; that is failure wearing a garland. Comparison anaesthetizes us — it measures us against the people nearby instead of the purpose we were made for. Jesus told of a rich man whose barns were full while heaven called him a fool — full barns, unopened book. Do not let what you have achieved talk you out of discovering who you are.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Where has doing well quietly replaced knowing who you are?

— Whose applause are you most afraid to lose — and what has it cost you?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Lord, I refuse to let my achievements answer a question only You can answer. Deliver me from the anaesthesia of applause and comparison. Measure me by the book You wrote about me, not by the people around me. Amen.'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Luke 12:13–21; 2 Corinthians 10:12'),
  (3, 1, 'scripture', 'Today''s Reading', 'Galatians 1:10', '“Am I now trying to win the approval of human beings, or of God? … If I were still trying to please people, I would not be a servant of Christ.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'We live in the first generation in history that carries a stage in its pocket. Every day, millions polish an image of a person who does not exist, and then feel crushed when reality cannot keep up with the profile. People''s true value and authenticity are being washed away in the pursuit of imitating their idols. Imitation is the sincerest form of self-abandonment. Every hour spent becoming a copy of someone else is an hour your true self goes unlived. And here is the psychology of it: we imitate because we fear that who we actually are is not enough. The gospel breaks that fear at the root — the God who had every option available made you on purpose, in His own image, and He does not create surplus people. You were never designed to trend. You were designed to become.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Who are you tempted to imitate — and what do you secretly believe they have that you lack?

— What part of the "image" you present to others is furthest from the truth?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, forgive me for auditioning for people when I was already accepted by You. I lay down the exhausting work of being someone else. Teach me to be fully, courageously the person You made. Amen.'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Galatians 1:10; 1 Samuel 16:7'),
  (4, 1, 'scripture', 'Today''s Reading', 'Acts 17:26', '“From one man he made all the nations, that they should inhabit the whole earth; and he marked out their appointed times in history and the boundaries of their lands.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'You cannot know who you are until you know where you came from. Paul told the philosophers of Athens that every nation on earth came from one man — one blood. Beneath every tribe, class and passport, humanity shares a single origin, and that origin bears the image of God. This truth does two surgeries at once. It removes inferiority: no one on earth is made of better material than you. And it removes superiority: no one is made of worse. The ground at the foot of the cross — and at the gate of identity — is perfectly level. Notice something else in the verse: God marked out your appointed time and your boundaries. You were not born in the wrong country, the wrong family or the wrong century. Your origin was planned by a meticulous God who keeps records.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Have you treated your background — family, tribe, class — as a verdict on your worth?

— What changes if your birthplace and birth-time were appointments, not accidents?'),
  (4, 4, 'devotional', 'Pray', NULL, 'God of all flesh, thank You that I come from You before I come from anyone else. Heal every place where my background has spoken louder than my origin. I accept my appointed time and my ground. Amen.'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Acts 17:24–28; Genesis 1:26–28'),
  (5, 1, 'scripture', 'Today''s Reading', '2 Corinthians 3:18', '“And we all, who with unveiled faces contemplate the Lord’s glory, are being transformed into his image with ever-increasing glory.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Every mirror you have ever consulted was cracked. The mirror of other people''s opinions bends with their moods. The mirror of your feelings changes with your sleep, your hunger, your losses. Even the mirror of your successes shows you only what you have done, never who you are. There is one uncracked mirror: Jesus Christ. He is the exact image of the invisible God — and therefore the truest picture of what a human being was always meant to be. To know who you are, look long at who He is. We do not find ourselves by gazing inward; we find ourselves by gazing upward, and the Scripture promises that what we behold, we become. Identity, it turns out, is not archaeology — digging into yourself. It is photography — long exposure to the light of His face.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Which cracked mirror do you consult most often — opinions, feelings, or achievements?

— What would "long exposure" to Jesus practically look like in your week?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, perfect image of God, I turn from the cracked mirrors. As I behold You in Your Word, transform me from one degree of glory to another, until I resemble the person heaven already sees. Amen.'),
  (5, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 3:12–18; Colossians 1:15'),
  (6, 1, 'scripture', 'Today''s Reading', 'John 1:12', '“Yet to all who did receive him, to those who believed in his name, he gave the right to become children of God.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Notice the wording: the right to become. Not a feeling, not a wish — a legal right, conferred by the highest court in existence. When you received Christ, your identity changed at the level of paperwork in heaven: a birth certificate, not a membership card. Psychology tells us that a child''s sense of self is built first from the face of a parent — we learn who we are from how we are looked at. Many of us are still living out of distorted faces: the absent father, the harsh critic, the one who never noticed. Today the gospel offers you a new face to grow up under. Your Father in heaven looks at you and is not disappointed; the Spirit in you cries “Abba” — the sound of a child utterly at home. You are no longer a slave auditioning for a place. You are a child who owns one.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Whose face taught you who you are — and what did it teach you?

— What would you attempt this year if you were certain the Father delights in you?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Abba Father, I receive the right to be called Your child. Where other faces wrote lies on my identity, write Your truth. Let my heart settle into the confidence of a loved son, a loved daughter. Amen.'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'John 1:12–13; Romans 8:14–17'),
  (7, 1, 'scripture', 'Today''s Reading', 'John 15:15', '“I no longer call you servants… Instead, I have called you friends, for everything that I learned from my Father I have made known to you.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Being a child speaks of belonging. Friendship speaks of something even more surprising: access. Jesus defines His friendship by disclosure — everything I learned from my Father I have made known to you. Friends are the people we tell things. Loneliness is one of the deepest wounds of our generation; we are the most connected and least known people in history. Into that ache, the Son of God says: I call you friend. Not fan. Not follower. Friend — someone He confides in, someone He wants at the table, someone whose company He chose when He chose the twelve “that they might be with him.” An identity built on His friendship cannot be dismantled by anyone''s rejection. People may leave your table. He never leaves His — and your seat has your name on it.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Do you relate to Jesus as staff or as friend? What is the difference in practice?

— What is He making known to you in this season that you have been too busy to hear?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, thank You for calling me friend. Teach me the rhythms of friendship with You — unhurried time, honest words, shared secrets. Heal what rejection has broken, at the table where I am always welcome. Amen.'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'John 15:9–17; Exodus 33:11'),
  (8, 1, 'scripture', 'Today''s Reading', 'Judges 5:20', '“From the heavens the stars fought, from their courses they fought against Sisera.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'In the song of Deborah, heaven reads out a register: kings came and fought; princes offered themselves willingly; nobles came down; captains carried a commander''s staff; villagers arose. And above them all, a rank we forget: the stars fought from their courses. Men are identified by their ranks — yes, men have ranks in the spirit. You are not a random unit in a crowd of eight billion. In the realm of the spirit you hold a station, a post, an assignment with your name on it. When you were born, it was the rising of a star, and the watchmen of darkness took note; when you were born again, the angels of God rejoiced. The enemy has never doubted your rank. That is precisely why he works so hard to keep you from discovering it.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Have you been living like a spectator in a realm where heaven lists you as a soldier?

— What might your "post" be — the place where your presence makes darkness nervous?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Lord of hosts, open my eyes to my rank in Your kingdom. May my star be unveiled; may every shroud over my life be removed. I report for the post You assigned me before I was born. Amen.'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Judges 5:1–31; Daniel 12:3'),
  (9, 1, 'scripture', 'Today''s Reading', 'Romans 8:1', '“Therefore, there is now no condemnation for those who are in Christ Jesus.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Identity is not only discovered; it is declared. Your life moves in the direction of your words, and many of us have spent years prophesying against ourselves — I am a failure, I am always late, I am not enough. Today, we change what the court hears. Read these aloud. Slowly. Your own ears need to hear your own mouth agree with heaven: I am a child of God (John 1:12). There is no condemnation for me (Romans 8:1). I am a friend of Jesus (John 15:15). I am a new creation (2 Corinthians 5:17). I am God''s workmanship (Ephesians 2:10). I am a royal priesthood (1 Peter 2:9). I am more than a conqueror (Romans 8:37). I am the light of the world (Matthew 5:14). I am Christ''s ambassador (2 Corinthians 5:20). I am complete in Him (Colossians 2:10). Ten declarations. Heaven stands behind every one.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Which declaration was hardest to say aloud — and what does that reveal?

— What have you been habitually saying about yourself that heaven never said?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, put Your words in my mouth about my own life. Where I have agreed with the accuser, I now agree with You. I will say who I am until I see who I am. Amen.'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Romans 8:31–39; Proverbs 18:21'),
  (10, 1, 'scripture', 'Today''s Reading', 'Ephesians 2:10', '“For we are God’s handiwork, created in Christ Jesus to do good works, which God prepared in advance for us to do.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Identity is never given for decoration; it is given for deployment. God does not tell you who you are so you can frame it — He tells you who you are so you can spend it. You are His workmanship, and the works were prepared before you were. This is where the mirror question finally comes to rest. Who am I? I am a child of the Father, a friend of Jesus, made from one blood, carrying a rank in the spirit, with a book in heaven and works prepared in advance for my hands. The question that once haunted you becomes the commission that sends you. Ten days ago you stood at the mirror. Today, walk away from it — not because the question no longer matters, but because it has been answered by Someone whose answers do not change.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— What "good works prepared in advance" might already be within reach of your hands?

— How will you answer differently, the next time life asks who you are?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Lord, thank You for answering the question of my life. Now send me. Let my unshakable identity become unstoppable assignment, and let the world around me benefit from who You made me to be. Amen.'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 2:1–10; Jeremiah 1:5 You have finished this plan — but the mirror will keep asking. When it does, answer it with the Word, not with your circumstances. This plan is drawn from The Power to Become by Moses Mwicigi, where the journey continues: your origin, your assignment, your star, and the book heaven wrote about you.')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- where-did-i-come-from (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('where-did-i-come-from', 'Where Did I Come From?', 'Finding worth in your origin', 'Every person carries a quiet question underneath their confidence: where do I actually come from — and does it make me matter? Some of us were taught to be ashamed of our beginnings: the village, the poverty, the family name, the story of how we arrived. This plan goes further back than all of that. Your true origin is not your hometown. Before geography, before genealogy, you began in the heart and hands of God — chosen in Christ before the creation of the world, formed in secret, written in a book before one of your days had happened. For ten days we will walk your real family line — from the breath of God, through the image you bear, to the Second Adam who made you new. When you know where you truly come from, no one can tell you where you cannot go.', 'Identity', 10, 6, 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'where-did-i-come-from');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Ephesians 1:4', 'You Began in Christ'),
  (2, 'Acts 17:26', 'One Blood, One Family'),
  (3, 'Genesis 1:27', 'The Image You Bear'),
  (4, 'Psalm 139:16', 'The God of Records'),
  (5, 'Psalm 139:13–14', 'Woven in Secret'),
  (6, 'Genesis 2:7', 'The Breath That Makes You'),
  (7, 'Acts 17:26–27', 'Appointed Time, Appointed Ground'),
  (8, 'Colossians 1:15', 'The Perfect Mirror'),
  (9, '1 Corinthians 15:45, 49', 'A New Bloodline'),
  (10, 'Acts 17:28', 'Live From Your Origin')
) AS v(n, ref, title) WHERE p.code = 'where-did-i-come-from';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'where-did-i-come-from'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:4', '“For he chose us in him before the creation of the world to be holy and blameless in his sight.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Where did you come from? The deepest answer is not a place — it is a Person. Before the world was created, God chose you in Him, in Christ. Your story does not begin at your birth, or even at your conception. It begins in the eternal counsel of God, before there were stars to count. This means your existence was not a response to circumstances — not your parents'' planning, nor their lack of it. Heaven''s decision preceded every earthly one. The becoming life is built on this rock: you are not an afterthought trying to earn a place. You are a fore-thought — loved, chosen, and placed. Everything else these ten days will simply unpack what was true before the beginning.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— How does it change your self-worth to date your origin before creation?

— What "earthly beginning" have you allowed to define you until now?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Father, thank You that my true beginning is in Christ, before the world was formed. I trade the shame of my earthly beginnings for the glory of my eternal one. Amen.

_May you carry yourself today like a fore-thought of God._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 1:3–6; 2 Timothy 1:9'),
  (2, 1, 'scripture', 'Today''s Reading', 'Acts 17:26', '“From one man he made all the nations, that they should inhabit the whole earth; and he marked out their appointed times in history and the boundaries of their lands.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'We are all made from one blood — from Adam. Underneath every tribe, color, class and passport, humanity shares a single origin, and that origin bears the fingerprints of God. This truth performs two liberations at once. It ends inferiority: no human being on earth is made of finer material than you — not the wealthy, not the famous, not the powerful. And it ends superiority: no one is made of lesser material either. The ground of human worth is perfectly level. Whatever your background whispered — too poor, too rural, wrong family, wrong side of town — your bloodline answers back: one blood, one Maker, one image. You come from the same stock as kings.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Where has your background been allowed to rank you beneath others?

— Is there anyone you have quietly ranked beneath yourself?'),
  (2, 4, 'devotional', 'Pray', NULL, 'God of all nations, thank You for the level ground of one blood. Heal me of inferiority and cleanse me of superiority. I take my place in the one family of mankind — with dignity. Amen.

_May you never again bow to a hierarchy heaven never built._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Acts 17:24–28; Malachi 2:10'),
  (3, 1, 'scripture', 'Today''s Reading', 'Genesis 1:27', '“So God created mankind in his own image, in the image of God he created them; male and female he created them.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'In the ancient world, kings placed images of themselves in distant provinces to declare: this territory is mine. Then Genesis makes its stunning announcement — God placed His image not in statues, but in people. You are heaven''s declaration in your neighborhood. If we were made from the first man, we truly bear the image and character of God. This is why every human life carries unnegotiable worth — the porter and the president bear the same crest. Sin has cracked the image, but it has not erased it — and in Christ, the restoration is underway. You are being renewed “in the image of your Creator” (Colossians 3:10). You come from God, you resemble God, and by grace you are growing back into the family likeness.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Do you treat yourself as an image-bearer — in your words about yourself, your standards, your hopes?

— Whose image-bearing dignity do you most need to start honoring?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Creator God, I bear Your image — let me carry it consciously today. Restore in me the family likeness, and teach me to honor Your image in every person I meet. Amen.

_May the family resemblance grow visibly in you this season._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Genesis 1:26–31; Colossians 3:9–10'),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 139:16', '“Your eyes saw my unformed body; all the days ordained for me were written in your book before one of them came to be.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'If there is one character of God that runs through all of Scripture, it is His meticulous planning and record keeping. Genealogies preserved for millennia. Censuses counted twice. Hairs numbered. Tears kept in a bottle (Psalm 56:8). Heaven is a place of books. And you are in them. Before your first day happened, all your days were written. Your birth did not begin your story; it published a manuscript that was already complete in the mind of God. A person who knows they are recorded lives differently from a person who feels random. You are not an entry in the world''s statistics. You are a volume in heaven''s library — authored, dated, and shelved with intention.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Does your life currently feel random or recorded? What would change if you believed the book?

— Which of your "chapters" makes more sense when you assume it was known in advance?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, thank You that my days were written before they were lived. I am not random; I am recorded. Help me live today like a page You authored. Amen.

_May you feel the dignity of a life that heaven wrote down._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Psalm 139:13–18; Psalm 56:8'),
  (5, 1, 'scripture', 'Today''s Reading', 'Psalm 139:13–14', '“For you created my inmost being; you knit me together in my mother’s womb. I praise you because I am fearfully and wonderfully made.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Knitting is slow, deliberate work — loop by loop, chosen colors, counted stitches. That is the Bible''s picture of your formation: not mass production, but handcraft. Your frame, your face, your temperament, the wiring of your mind — knit, on purpose, by Hands that do not slip. David''s response was not analysis but praise: I praise you because I am fearfully and wonderfully made. Some of us have never once thanked God for how we are made; we have only filed complaints. Today, reverse the file. The features you were teased for, the sensitivity you were told to toughen out of, the mind that works differently — inspect them again as chosen stitches. The Craftsman does not knit accidents.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Which "stitch" in your design have you resented — and can you consider it chosen?

— What would it sound like to genuinely praise God for how you are made?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Master Craftsman, I withdraw my complaints and I bring praise: I am fearfully and wonderfully made. Teach me the purpose of every stitch I once resented. Amen.

_May you catch the Craftsman''s delight when you next pass a mirror._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Psalm 139:13–16; Isaiah 64:8'),
  (6, 1, 'scripture', 'Today''s Reading', 'Genesis 2:7', '“Then the Lord God formed a man from the dust of the ground and breathed into his nostrils the breath of life, and the man became a living being.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Your body was formed from dust — common material, shared with the ground you walk on. But you did not become you until God exhaled. The breath in your lungs right now is on loan from that first divine breath. This is why nothing on earth fully satisfies the human heart: you are a spirit, housed in a body, made alive by the breath of God — and “the dust returns to the ground it came from, and the spirit returns to God who gave it” (Ecclesiastes 12:7). You come from Him, and you are designed to return to Him — which means you are designed to live toward Him now. Man is a spiritual being clothed in a physical body, and God will always interact with man at the spiritual level. Your origin explains your homesickness — and your destination.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Have you been trying to satisfy a spiritual origin with only physical supplies?

— What practice would help you "live toward" the One your spirit came from?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Breath of God, You are the life in my lungs and the home of my spirit. I stop feeding my spirit dust. Draw me daily toward the One I came from. Amen.

_May every breath today remind you whose exhale you are._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Genesis 2:7; Ecclesiastes 12:7; Job 32:8'),
  (7, 1, 'scripture', 'Today''s Reading', 'Acts 17:26–27', '“…he marked out their appointed times in history and the boundaries of their lands. God did this so that they would seek him and perhaps reach out for him and find him.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'You were not only made on purpose — you were placed on purpose. Your century, your country, your city: marked out in advance. The Kenyan village or the crowded capital, the year of your birth, the era of your strength — appointments, all of them. And Scripture even gives the reason for the placement: so that they would seek him and find him. Your coordinates were chosen as the best possible ground for you to find God — and for the people around you to find Him through you. Stop apologizing for your ground. The soil you were planted in is not the obstacle to your becoming; it is the appointed field of it. Yet He is actually not far from each one of us.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Have you treated your birthplace and era as a limitation or an appointment?

— Who around your "appointed ground" might find God through your presence there?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, I accept my coordinates — my land, my times, my ground. You planted me here to seek You and to be found by others. Make my placement fruitful. Amen.

_May your appointed ground begin to look like holy ground._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Acts 17:26–28; Esther 4:14'),
  (8, 1, 'scripture', 'Today''s Reading', 'Colossians 1:15', '“The Son is the image of the invisible God, the firstborn over all creation.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'If you want to know what you came from — and what you are becoming — do not study your relatives. Study Christ. He is the exact image of the invisible God, and therefore the perfect picture of everything humanity was meant to be. Christ is the perfect image displayed in the mirror at which we correct ourselves. Every other mirror distorts. Family mirrors pass down their cracks; culture''s mirrors change shape yearly; the mirror of your worst day lies outright. But look long at Jesus — His courage, His compassion, His communion with the Father — and you are looking at your origin and your destination at once. “As we behold Him, we are transformed into the same image, from glory to glory” (2 Corinthians 3:18). Beholding is becoming. Choose your mirror carefully.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Which cracked mirror has most shaped your self-understanding?

— What specific trait of Christ will you "behold" deliberately this week?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, perfect image of the invisible God, be my mirror. As I behold You, correct in me every distortion the other mirrors left. Transform me from glory to glory. Amen.

_May the mirror of Christ show you both where you came from and where you are going._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Colossians 1:15–20; 2 Corinthians 3:18'),
  (9, 1, 'scripture', 'Today''s Reading', '1 Corinthians 15:45, 49', '“So it is written: “The first man Adam became a living being”; the last Adam, a life-giving spirit… And just as we have borne the image of the earthly man, so shall we bear the image of the heavenly man.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'From Adam you inherited much — the image of God, yes, but also the fracture: the tendencies, the weaknesses, the mortality of the earthly man. Some of what runs in your natural family line, you have felt running in you. Here is the gospel''s genealogy-changing news: there is a Second Adam, and in Christ you have been grafted into a new bloodline. “If anyone is in Christ, the new creation has come” (2 Corinthians 5:17). The old family patterns are no longer your masters; the heavenly Man''s likeness is now your inheritance. You honor your earthly family — and you outgrow its fractures. Your truest ancestry is no longer behind you. It is above you.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Which inherited pattern have you assumed was simply "who you are"?

— What does it mean to live from the Second Adam''s bloodline this week?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, thank You for grafting me into the bloodline of the last Adam. I receive the inheritance of the heavenly Man, and I release every fracture of the earthly one. Amen.

_May the new bloodline in you prove stronger than every old pattern._'),
  (9, 5, 'reading', 'Go Deeper', NULL, '1 Corinthians 15:45–49; 2 Corinthians 5:17'),
  (10, 1, 'scripture', 'Today''s Reading', 'Acts 17:28', '“For in him we live and move and have our being. As some of your own poets have said, “We are his offspring.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Ten days of ancestry, and here is the summary: you began in Christ before creation; you share one blood with all mankind; you bear the image of God; you are recorded, knit, breathed, placed; the perfect mirror is Jesus; and your new bloodline outranks your old one. We are His offspring. Now the commissioning: live from your origin, not toward it. People who do not know where they come from spend their lives seeking approval — auditioning for a worth they already possess. People who know their origin spend their lives on assignment. You do not need this world''s permission to matter. You came from God, you live and move in Him, and you will return to Him with a finished book. Walk accordingly.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— What audition can you finally cancel now that your origin is settled?

— How will you introduce yourself — to yourself — from now on?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, in You I live and move and have my being. I cancel the auditions and take up the assignment. I will live from my origin all the days written in Your book. Amen.

_May you walk out of this plan the way royalty walks out of a palace — knowing exactly whose house you come from._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Acts 17:24–31; 1 John 3:1–2')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- healed-of-rejection (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('healed-of-rejection', 'Healed of Rejection', 'Ten days from wounds to welcome', 'Rejection is the sense of being unwanted, unloved and unwelcomed — and it may be the most common wound in the world. It enters through a parent''s absence, a broken engagement, unkind words, a divorce, a betrayal — sometimes it enters before we are even born. And because we were created by a loving God to love and to be loved, nothing brings out the worst in us like the absence of love. But here is the hope this plan is built on: you are walking with a Savior who was “despised and rejected — a man of sorrows, acquainted with bitterest grief” (Isaiah 53:3). Christ does not observe your rejection from a distance. He entered it, carried it, and rose on the other side of it — and He knows the way out. Ten days. One wound. One Healer. By the end, you will not just feel better — you will be free to love again, and favor will show on your face.', 'Healing', 10, 7, 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'healed-of-rejection');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Isaiah 53:3', 'The Rejected Christ Understands You'),
  (2, 'Psalm 147:3', 'Naming the Wound'),
  (3, 'Jeremiah 1:5', 'Known Before the Womb'),
  (4, 'Psalm 27:10', 'Though Father and Mother Forsake Me'),
  (5, 'Romans 12:2', 'The Lies the Wound Taught You'),
  (6, 'Ephesians 4:31–32', 'Hurting People Hurt People — Healed People Heal Them'),
  (7, 'Isaiah 49:15–16', 'Engraved on His Palms'),
  (8, 'Galatians 3:13–14', 'Redeemed From Every Curse'),
  (9, 'Psalm 34:5', 'Favor on Your Face'),
  (10, 'Ephesians 1:4, 6', 'Chosen — and Choosing to Bless')
) AS v(n, ref, title) WHERE p.code = 'healed-of-rejection';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'healed-of-rejection'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Isaiah 53:3', '“He was despised and rejected by mankind, a man of suffering, and familiar with pain… he was despised, and we held him in low esteem.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Before we touch your wound, meet the One who carries the same scar. Jesus was misunderstood by His family, betrayed by His friend, denied by His disciple, exchanged for a criminal by the crowd He came to save, and — in the darkest moment in history — He cried, “My God, my God, why have you forsaken me?” There is no rejection you have tasted that He has not drained to the bottom. When you pray about being unwanted, you are not explaining something foreign to Him; you are speaking His mother tongue. And watch what heaven did with the rejected One: “the stone the builders rejected has become the cornerstone” (Psalm 118:22). That is the pattern of your healing. In the hands of God, rejected stones become cornerstones.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What does it change to know that Christ personally understands rejection from the inside?

— Where in your life might God be turning a rejected stone into a cornerstone?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, Man of Sorrows, You know this wound by name. I bring my rejection to the only One who was rejected more deeply and loved more perfectly. Begin Your healing in me today. Amen.

_May you feel deeply understood today — by the God who has felt what you feel._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Isaiah 53:1–5; Psalm 118:22–23; Matthew 27:46'),
  (2, 1, 'scripture', 'Today''s Reading', 'Psalm 147:3', '“He heals the brokenhearted and binds up their wounds.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'A wound cannot be healed while it is unnamed. So let us say it plainly: rejection is being cast aside, unwelcomed, devalued — thrown away as though worthless. At its root, rejection is the absence of love, and because every human being was created to love and be loved, that absence wounds us at the deepest level we have. Perhaps yours came through divorce or a broken engagement; through comparison to a sibling; through abuse; through a cycle of failures; through unkind words that lodged like arrows. However it came, it was real, and God does not ask you to pretend otherwise. But notice today''s verse: He binds up wounds — which means heaven treats your wound as legitimate. You are not weak for hurting. You are human, and you are already on the Healer''s schedule.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— If you traced your sense of being unwanted to its first door, where did it enter?

— Have you allowed yourself to call it a wound — or have you been calling it weakness?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, I stop pretending. Here is my wound — I name it before You. Thank You that You do not despise the brokenhearted; You bind them up. I place myself under Your bandage today. Amen.

_May naming the wound today be the beginning of losing it forever._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Psalm 147:3; Psalm 34:18'),
  (3, 1, 'scripture', 'Today''s Reading', 'Jeremiah 1:5', '“Before I formed you in the womb I knew you, before you were born I set you apart.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Some rejection begins before birth. A child conceived unplanned, unwanted, or arriving as the “wrong” gender can carry a sense of being an intrusion into the world — a guest nobody invited. If that is your story, today''s word is surgery. Whatever the circumstances of your conception, you were never God''s accident. Before your mother knew you existed, your Maker knew you personally — knew you, set you apart, wrote your days in His book (Psalm 139:16). Human planning and divine purpose are two different registries, and heaven''s registry has always had your name. You were not merely allowed into the world. You were sent. There is a difference, and healing begins where that difference is believed.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Have you carried a quiet feeling of being an intrusion — a guest nobody invited?

— What changes when you replace "I happened" with "I was sent"?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, before the womb, You knew me. I renounce the lie that I am an accident, an intrusion, an inconvenience. I accept heaven''s registry: I was set apart and sent. Amen.

_May the sent-ness of your life silence every whisper that you were unwanted._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Jeremiah 1:4–8; Psalm 139:13–18'),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 27:10', '“Though my father and mother forsake me, the Lord will receive me.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'The deepest rejections wear family faces. The absent father. The critical mother. The home where you learned to read moods before you learned to read books. Parental wounds cut deepest because parents were designed to be our first picture of God. David''s verse faces the worst case without flinching: though my father and mother forsake me. Even if the two people ordained to want you did not — the Lord will receive you. The word means to gather up, the way one lifts an abandoned child from the roadside and carries it home. Your identity does not come from those who rejected you; it comes from the One who received you. People''s rejection is information about their capacity, never a verdict on your value.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Has a family wound been shaping your picture of God? In what way?

— What would it mean to let the Lord "gather you up" in the exact place a parent let you down?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, where my first pictures of love were broken, paint Yours. I bring You the family wounds I have carried quietly for years. Receive me, gather me, and re-parent my heart. Amen.

_May the Father''s receiving heal every place a parent''s forsaking has touched._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Psalm 27:7–14; Isaiah 49:15–16'),
  (5, 1, 'scripture', 'Today''s Reading', 'Romans 12:2', '“Do not conform to the pattern of this world, but be transformed by the renewing of your mind.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Rejection is a teacher, and it teaches lies. Its favorite is over-generalization: rejected by one man, we conclude “all men are the same”; betrayed by one friend, we mistrust every hand extended since. One person''s failure becomes a doctrine about the whole human race — and innocent people pay an old bill they never owed. The wound also builds a hard shell: we grow insensitive to protect ourselves from future hurts, and the armor that keeps pain out keeps love out with it. Healing means letting Christ renew the mind the wound has trained. Not all people are your past. Today, gently, let one lie be named and retired: the next person is not the last person. Your future does not deserve your history''s sentence.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— What "all people are…" doctrine did your wound write — and who is paying its bill today?

— Where has your protective shell been keeping out love along with hurt?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Lord, expose the lies my wound taught me and retire them one by one. Soften the shell without leaving me unguarded — You be my protection, so my heart can be open. Amen.

_May your heart un-learn the lies and stay soft — guarded by God, not by walls._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Romans 12:2; Ezekiel 36:26'),
  (6, 1, 'scripture', 'Today''s Reading', 'Ephesians 4:31–32', '“Get rid of all bitterness, rage and anger… Be kind and compassionate to one another, forgiving each other, just as in Christ God forgave you.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'There is a sobering law in the world of wounds: rejected people reject others; hurting people hurt people. The pain we do not transform, we transmit — to spouses, to children, to anyone standing close when the old wound is touched. But the law works in the other direction too, and this is today''s good news: healed people heal people. The kindness of a restored heart carries medicine into every room it enters. The hinge between the two is forgiveness — and hear this clearly: forgiveness is not an emotion; it is a decision. It is not saying the rejection didn''t matter; it is refusing to drink poison hoping the one who hurt you feels it. Release them into God''s hands today — not because they deserve it, but because you deserve to be free.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Who has been receiving pain you did not transform?

— Whom do you need to release today by decision, even before feelings agree?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, I choose — by decision, not emotion — to forgive those who rejected me. I release them into Your hands and I take my heart back. Make me a healer of the very wound I carried. Amen.

_May the cycle break with you — and may your hands become healing hands._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 4:29–32; Matthew 18:21–35'),
  (7, 1, 'scripture', 'Today''s Reading', 'Isaiah 49:15–16', '“Can a mother forget the baby at her breast and have no compassion on the child she has borne? Though she may forget, I will not forget you! See, I have engraved you on the palms of my hands.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'God reaches for the strongest human bond He can find — a nursing mother and her baby — and then says something astonishing: even if that bond fails, Mine will not. Human love, at its very best, can forget. Divine love cannot. Then the image sharpens: I have engraved you on the palms of my hands. Not written in ink, which fades; engraved, cut in. And for the Christian, the image becomes literal — there are nail marks in the palms of Christ, and your name lives in them. Every time the enemy says “forgotten,” heaven holds up two scarred hands. You are not an entry in God''s diary. You are an engraving in His flesh.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— What situation has made you feel forgotten by God?

— What does it mean to you that your remembrance cost Christ His hands?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, when I feel forgotten, show me Your hands. I am engraved, not jotted; cut into Your palms, not penciled in Your margins. I rest in a love that cannot forget me. Amen.

_May you see your name in His palms every time the world overlooks you._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Isaiah 49:13–16; John 20:24–29'),
  (8, 1, 'scripture', 'Today''s Reading', 'Galatians 3:13–14', '“Christ redeemed us from the curse of the law by becoming a curse for us… He redeemed us in order that the blessing given to Abraham might come to the Gentiles through Christ Jesus.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Some rejection is not merely emotional; it functions like a shadow over a life — patterns of being overlooked, doors that close without reason, a script of exclusion that repeats. Whatever its source, hear the gospel''s verdict: Christ has already dealt with every curse at its root. He was made a curse for us — hung on the tree, rejected by earth and, for one dark hour, heaven — so that the blessing of Abraham could flow to you. The exchange is complete: His rejection purchased your acceptance; His exclusion purchased your welcome. You do not need to break what Christ has already broken. You need to stand in the finished work: the shadow has no legal claim on a redeemed life. Walk out from under it, blessed.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Have you noticed repeating patterns of exclusion that feel bigger than circumstance?

— What does it mean to stand in an exchange that is already finished?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You became a curse so I could become blessed. I stand in that exchange now: every shadow of rejection over my life is cancelled at Your cross. I receive the blessing of Abraham. Amen.

_May the blessing purchased for you settle visibly on your life this week._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Galatians 3:10–14; Deuteronomy 28:1–14'),
  (9, 1, 'scripture', 'Today''s Reading', 'Psalm 34:5', '“Those who look to him are radiant; their faces are never covered with shame.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Here is a secret about rejection: it shows. Walk into an interview carrying an old rejection and it sits in your posture, your eyes, your tone — and the room responds to what you carry. Wounded expectation has a way of manufacturing the very rejection it fears. That is why we need freedom — so that favor can show on our faces. The Psalmist gives the beauty treatment of heaven: those who look to Him are radiant. Radiance is not cosmetics; it is the glow of a face that has been looking at unconditional love. Shame cannot survive on a face that beholds Him. As healing settles in, expect the practical harvest: rooms will respond differently, because you will enter them differently. Favor is attracted to a healed countenance.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— What have your face and posture been announcing before you speak?

— How can "looking to Him" become your daily beauty routine?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, heal my countenance. Let the old rejection drain from my eyes and Your radiance take its place. I will look to You until favor shows on my face. Amen.

_May people meet the favor on your face before they learn your name._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Psalm 34:1–8; Numbers 6:24–26'),
  (10, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:4, 6', '“For he chose us in him before the creation of the world… to the praise of his glorious grace, which he has freely given us in the One he loves.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Ten days ago you began as the unwanted one. Hear your closing verdict: chosen before the creation of the world, adopted in love, accepted in the Beloved. The last word over your life was never rejection; it was election. Now comes the commissioning, because healed people are given assignments. Become a chooser of others. Speak blessing over your children and refuse to compare them — each one is unique. Create warm memories; pray and play with them. Be present — they need your presence more than your presents. Dedicate them to God and prophesy good over their futures. And where there are no children, do this for every soul in your circle: welcome the unwelcomed, choose the overlooked. The wound you carried is now a well others can drink from. That is the glory of God: nothing wasted, everything redeemed.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Who in your world is waiting to be chosen the way you have been chosen?

— What blessing will you speak over your children — or your circle — this very week?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, I stand accepted in the Beloved — chosen before the world began. Make me a chooser: my home a place of welcome, my words a fountain of blessing, my healed heart a well for the thirsty. Amen.

_May you never again introduce yourself as the rejected one — you are the chosen of God._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 1:3–14; 1 Peter 2:9–10')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- fear-not (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('fear-not', 'Fear Not', 'Ten days to a fearless heart', 'Fear is a faithful visitor. It comes at night when the bills are counted, in the morning before the results, in the quiet after the diagnosis. If your heart has learned to race, this plan was written for you — not to scold your fear, but to introduce it to Someone stronger. Here is the good news we will unwrap for ten days: peace is not a feeling you must manufacture. It is a gift Christ has already handed over — “Peace I leave with you; my peace I give you.” Some form of “fear not” appears in Scripture again and again, close to one for every day of the year, because your Father knew how often His children would need to hear it. Come as you are, anxious thoughts and all. By day ten you will not merely know about peace; you will know the Prince of it.', 'Courage', 10, 8, 'https://images.unsplash.com/photo-1519681393784-d120267933ba?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'fear-not');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'John 14:27', 'The Gift Has Already Been Given'),
  (2, 'Isaiah 41:10', 'The Most Repeated Command'),
  (3, '2 Timothy 1:7', 'Fear Is a Visitor, Not a Landlord'),
  (4, 'Mark 4:38–39', 'The Storm and the Pillow'),
  (5, 'Philippians 4:6–7', 'Trade Your Worry for Worship'),
  (6, '1 Peter 5:7', 'Cast It — and Leave It There'),
  (7, 'Matthew 6:26', 'The Sparrow Ledger'),
  (8, 'Proverbs 29:25', 'Free From the Fear of Faces'),
  (9, '1 John 4:18', 'The Love That Evicts Fear'),
  (10, 'Matthew 14:29–30', 'Eyes on Him, Feet on Water')
) AS v(n, ref, title) WHERE p.code = 'fear-not';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'fear-not'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'John 14:27', '“Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Begin with this settled fact: Jesus did not promise to send you peace someday. He left it — the way a man leaves an inheritance. My peace I give you. The peace that slept through a storm, stood silent before Pilate, and walked to a cross without panic — that very peace has your name on it. The world gives peace conditionally: peace if the money comes, peace if the results are good, peace if people approve. Jesus gives “not as the world gives” — His peace is anchored outside your circumstances entirely, in His finished work. So this journey does not begin with your effort. It begins with an inheritance you may simply have never unpacked.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What condition has your peace been waiting for — "I will rest when…"?

— What would today look like if you treated peace as already yours?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, I receive the peace You left for me. I stop waiting for conditions and I start unpacking the inheritance. Quiet my heart with what You have already finished. Amen.

_May the peace of Christ stand guard over your heart and mind today._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'John 14:25–27; Isaiah 9:6'),
  (2, 1, 'scripture', 'Today''s Reading', 'Isaiah 41:10', '“So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'The command God repeats most in Scripture is not about holiness, giving, or even love. It is fear not. Again and again, to shepherds and kings, to prophets and fishermen, the first word from heaven is almost always the same: do not be afraid. Why so often? Because your Father knows your frame. He is not surprised or offended by your anxiety; He planned ahead for it, the way a parent packs food for a journey knowing the child will get hungry. And notice the reason attached: not “fear not, for the danger is small,” but “fear not, for I am with you.” Heaven''s answer to fear has never been better circumstances. It has always been closer company.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— When fear speaks tonight, what "for I am with you" truth will you answer it with?

— Where in your life have you been asking God for better circumstances when He is offering closer company?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, thank You that You never tire of telling me not to fear. Teach my heart the reason: You are with me. Strengthen me, help me, uphold me today. Amen.

_May you feel the nearness of God in the very place you used to feel alone._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Isaiah 41:8–13; Deuteronomy 31:8'),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:7', '“For God has not given us a spirit of fear, but of power and of love and of a sound mind.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Fear itself is not sin — it is an alarm system, designed by God to protect you from real danger for short moments. The trouble begins when the alarm never switches off; when a visitor is given the master bedroom. Anxiety is fear that has signed a lease. Paul tells Timothy the truth that evicts it: the spirit of fear was not given by God. What God gave you is power, love and a sound mind — a mind that can be gathered, ordered, and settled. You are allowed to feel the alarm. You are not obligated to house the tenant. Today, begin addressing fear as what it is: a visitor overstaying a welcome it was never given.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Which fear has quietly moved from visitor to landlord in your life?

— What does it change to know that the fear you carry was never given to you by God?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, I receive what You have given — power, love and a sound mind — and I release what You never gave. Fear, you are a visitor; in Jesus'' name, the lease is cancelled. Amen.

_May every fear that outstayed its welcome leave your house today._'),
  (3, 5, 'reading', 'Go Deeper', NULL, '2 Timothy 1:6–10; Romans 8:15'),
  (4, 1, 'scripture', 'Today''s Reading', 'Mark 4:38–39', '“Jesus was in the stern, sleeping on a cushion. The disciples woke him and said to him, “Teacher, don’t you care if we drown?” He got up, rebuked the wind and said to the waves, “Quiet! Be still!”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Same boat. Same storm. Same water. Twelve men in a panic — and one Man asleep on a cushion. The difference was not information; Jesus knew about the storm. The difference was authority: He knew who was in charge of the water. Here is what the disciples discovered that night, and what you may discover this week: peace is not the absence of a storm. Peace is the presence of a Person in your boat. And the same voice that said “Quiet! Be still!” to the sea knows how to say it to a mind. You do not need the storm to end before you rest. You need to remember who is aboard.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— What storm are you currently in — and where is Jesus in your picture of it?

— What would "sleeping on the cushion" look like in your situation this week?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You are in my boat, and that changes the boat. Speak over my winds and waves — and speak over my mind — the word You spoke that night: Quiet. Be still. Amen.

_May you rest tonight like a man who knows who is in his boat._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Mark 4:35–41; Psalm 46:1–3, 10'),
  (5, 1, 'scripture', 'Today''s Reading', 'Philippians 4:6–7', '“Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God… will guard your hearts and your minds in Christ Jesus.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Paul wrote these words from a prison cell, which means they are not theory. His instruction is wonderfully practical: anxiety is not merely to be resisted — it is to be redirected. Every worry is a prayer request wearing the wrong clothes. Notice the small phrase that carries the power: with thanksgiving. Worry rehearses what could go wrong; thanksgiving rehearses what God has already done right. The two cannot occupy the same sentence — which is exactly why heaven prescribes them together. And the result is not that you guard your own heart. The peace of God garrisons it — a soldier posted at the door of your mind, checking every thought that seeks entry.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Take your loudest worry: what does it sound like re-dressed as a request with thanksgiving?

— What five things can you thank God for out loud, right now?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, I bring You my worries dressed as requests. Thank You for every past faithfulness — I name them before You now. Post Your peace at the door of my mind today. Amen.

_May the peace that passes understanding garrison your heart today._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Philippians 4:4–9'),
  (6, 1, 'scripture', 'Today''s Reading', '1 Peter 5:7', '“Cast all your anxiety on him because he cares for you.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'The word “cast” is a fisherman''s word — Peter knew it well. It means to throw decisively away from yourself, the way a net leaves the hand. It does not mean to dangle your anxiety over the water while keeping a grip on the rope. Most of us do not struggle to pray about our worries; we struggle to leave them where we prayed them. We hand God the burden and take it back on the way out, like a man who checks in luggage and then carries it onto the plane. And look at the reason the verse gives — not “because you are strong,” but because He cares for you. The basis of the casting is His affection. You can release what you carry because you are carried.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Which anxiety have you prayed about many times but never actually released?

— What ritual of release could help you — writing it down, speaking it out, opening your hands?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, today I do not dangle my anxiety — I cast it. Take the weight of the thing I have carried too long. And when my hands reach for it again, remind me: I am carried. Amen.

_May your shoulders forget the shape of the burden you cast today._'),
  (6, 5, 'reading', 'Go Deeper', NULL, '1 Peter 5:6–11; Psalm 55:22'),
  (7, 1, 'scripture', 'Today''s Reading', 'Matthew 6:26', '“Look at the birds of the air; they do not sow or reap or store away in barns, and yet your heavenly Father feeds them. Are you not much more valuable than they?”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Jesus'' cure for financial anxiety was to point at birds. Not because provision doesn''t matter — He was speaking to poor people who knew real hunger — but because birds keep a different ledger. They receive today''s food today, and sing anyway. Then He asks the question that resets everything: are you not much more valuable than they? Anxiety about provision is, at its root, a question about your value to the Provider. And heaven has already answered it — at Calvary, in blood. Notice, too, His timeframe: “do not worry about tomorrow.” God gives grace in daily bread, never in warehouse quantities. Today''s grace is for today''s needs. Tomorrow''s is already scheduled.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Is your anxiety mostly about today''s needs — or about tomorrows that have not arrived?

— What is today''s bread — the actual provision you already have for this actual day?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, feed me today like You feed the birds, and teach me to sing on the branch while I wait. I trust You for tomorrow — I will meet its grace when I meet its needs. Amen.

_May you find today''s table already set, and tomorrow''s already planned._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Matthew 6:25–34; Exodus 16:4'),
  (8, 1, 'scripture', 'Today''s Reading', 'Proverbs 29:25', '“Fear of man will prove to be a snare, but whoever trusts in the Lord is kept safe.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Not all fear has claws and darkness. Some fear wears a familiar face: the parent you can never please, the crowd you dress for, the opinions you check before you obey God. Scripture calls it the fear of man, and it is a snare — a trap that catches destinies. The freedom is not to stop caring about people; it is to stop being ruled by them. One holy fear displaces a thousand small ones: when God''s opinion becomes the loudest voice in your life, every other verdict becomes information, not identity. The becoming life cannot be lived on the approval of spectators. You have an Audience of One, and He is already applauding the person He made you to be.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Whose disapproval do you fear most — and what has that fear cost you?

— What obedience have you delayed because of a face?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, unhook my heart from the verdicts of people. Let Your voice be the loudest in my life, Your pleasure my prize. I choose the safety of trusting You. Amen.

_May the only face you live to please be the One that shines upon you._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 29:25; Galatians 1:10; John 12:42–43'),
  (9, 1, 'scripture', 'Today''s Reading', '1 John 4:18', '“There is no fear in love. But perfect love drives out fear, because fear has to do with punishment.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Here is the deepest surgery of this whole plan. Beneath most chronic fear lies one buried question: am I truly safe with God? Fear “has to do with punishment” — it thrives wherever we secretly suspect that the rod is still coming, that we are one mistake from being cast out. Perfect love answers the question permanently. At the cross, the punishment question was settled — “the punishment that brought us peace was on him” (Isaiah 53:5). You are not one mistake from rejection; you are one Savior from it, forever. Loved people fear less. Not because their circumstances improve, but because their foundation does. Let His love go deeper than your alarm system today.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Do you secretly relate to God as a probation officer or as a Father?

— Where would fear lose its grip if you were certain — bone-deep — that you are loved?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, let Your perfect love reach the room where my oldest fear lives. Settle the punishment question in my heart forever at the cross. Love me brave. Amen.

_May perfect love walk through your heart today and turn every fear out of doors._'),
  (9, 5, 'reading', 'Go Deeper', NULL, '1 John 4:16–19; Romans 8:31–39'),
  (10, 1, 'scripture', 'Today''s Reading', 'Matthew 14:29–30', '“Come,” he said. Then Peter got down out of the boat, walked on the water and came toward Jesus. But when he saw the wind, he was afraid…”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Peter walked on water — remember that part. We tell this story as a failure, but a fisherman stood on the sea, and he managed it exactly as long as his eyes stayed on Christ. He sank not when the wind grew stronger, but when his attention changed address. This is your commissioning: the becoming life will keep calling you out of boats, and the wind will keep auditioning for your attention. Fear is finally not conquered by analyzing the waves; it is conquered by a fixed gaze — “fixing our eyes on Jesus, the pioneer and perfecter of faith” (Hebrews 12:2). And even Peter''s sinking preaches: the moment he cried out, immediately Jesus caught him. The worst day of your faith still ends in His grip.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Where is Jesus saying "Come" — and what wind keeps stealing your gaze?

— Which practice from these ten days will you keep for life?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, I step out. When the wind shouts, fix my eyes; when I sink, catch me immediately. I choose a life of walking toward You — whatever the water does. Amen.

_May you live the rest of your days with your eyes on Him — and may every storm under your feet become a floor._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Matthew 14:22–33; Hebrews 12:1–3')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- new-grace (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('new-grace', 'New Grace', 'Ten mornings of fresh mercy', 'This plan is for the person replaying the failure at 2 a.m. The business that collapsed. The marriage that struggled. The sin you swore you would never repeat — repeated. Shame has a voice, and it preaches the same sermon every night: you had your chance. The Word of God preaches a better sermon: “His mercies never come to an end; they are new every morning” (Lamentations 3:22–23). Not recycled. Not leftover. New — manufactured fresh for this morning''s needs. And history agrees: God has a long habit of building His greatest stories out of people the world had filed under ''finished'' — a murderer named Moses, an adulterer named David, a persecutor named Paul, a denier named Peter. For ten days we will watch grace do what grace does. Bring your worst chapter. God writes sequels.', 'Grace', 10, 9, 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'new-grace');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Lamentations 3:22–23', 'New Every Morning'),
  (2, 'Exodus 3:11–12', 'The Murderer Who Led an Exodus'),
  (3, 'Psalm 51:10, 12', 'The King Who Fell — and Sang Again'),
  (4, '1 Timothy 1:15–16', 'Exhibit A of Unlimited Patience'),
  (5, '1 Samuel 12:20', 'The Great "Yet"'),
  (6, '2 Corinthians 12:9', 'Power Made Perfect in Weakness'),
  (7, 'John 21:9, 12', 'Breakfast for a Denier'),
  (8, 'Philippians 3:13–14', 'Forgetting What Is Behind'),
  (9, 'Luke 15:20', 'The Father Who Runs'),
  (10, 'Jonah 3:1–2', 'The Word Comes a Second Time')
) AS v(n, ref, title) WHERE p.code = 'new-grace';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'new-grace'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Lamentations 3:22–23', '“The steadfast love of the Lord never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Begin with where these words were written: not in a palace, but in the ashes of a destroyed Jerusalem. Jeremiah wrote “great is your faithfulness” while looking at rubble — much of it caused by his own people''s failures. Grace was not denying the ruins. Grace was rising on them like a sunrise. In Christ, this is your legal position, not just your poetry: “There is now no condemnation for those who are in Christ Jesus” (Romans 8:1). The punishment your failure deserved was fully carried at the cross. What remains for you each morning is not a verdict — it is mercy, newly minted. You did not exhaust God''s grace last night. You cannot. His mercies out-manufacture your failures, every single dawn.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What "rubble" have you been staring at — and can you say "great is Your faithfulness" over it?

— What would you attempt again if this morning''s mercy were truly new?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Father, I receive this morning''s mercy — not yesterday''s leftovers, but grace made new for today. Over my rubble I declare it: great is Your faithfulness. Amen.

_May this morning''s mercy feel as new to you as it actually is._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Lamentations 3:19–26; Romans 8:1–4'),
  (2, 1, 'scripture', 'Today''s Reading', 'Exodus 3:11–12', '“But Moses said to God, “Who am I that I should go to Pharaoh and bring the Israelites out of Egypt?” And God said, “I will be with you.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Moses'' résumé at eighty: a killing in his past, a failed first attempt at deliverance, and four decades of hiding in the wilderness. If ever a file looked closed, it was his. Then a bush caught fire. Notice what God did not do at that bush. He did not review the Egyptian incident. He did not demand an account of the wasted decades. He announced an assignment — as though the future were the only file He was holding. God uses the ones society calls disqualified; it is one of His signatures. Your failure did not cancel your assignment. In the economy of grace, even your wilderness years were training — Moses spent forty years learning the very desert he would later lead a nation through.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— What "Egyptian incident" do you assume disqualified you?

— What did your wilderness season teach you that your palace season never could?'),
  (2, 4, 'devotional', 'Pray', NULL, 'God of Moses, thank You that You call futures, not files. If You can send a fugitive to free a nation, You can still send me. Here I am. Amen.

_May a bush burn in your wilderness this week — and may you hear your assignment in it._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Exodus 2:11–15; 3:1–14; Acts 7:20–36'),
  (3, 1, 'scripture', 'Today''s Reading', 'Psalm 51:10, 12', '“Create in me a pure heart, O God, and renew a steadfast spirit within me… Restore to me the joy of your salvation.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'David''s failure was not a slip; it was a landslide — adultery, deception, and a man''s death arranged to hide it. Yet the Bible''s verdict over his whole life remains “a man after God''s own heart.” How? Not because the sin was small, but because the repentance was real. Psalm 51 shows us grace''s doorway: no excuses, no blame-shifting — “Against you, you only, have I sinned.” David brought God a broken spirit, and discovered the sacrifice God never despises. And here is the wonder: out of that very failure God brought forth Solomon, and through that family line, the Messiah. Grace does not merely clean up after our failures. Grace composts them — and grows kingdom fruit in the same soil.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Is there a confession you have been negotiating instead of making?

— What might God want to grow in the very soil of your worst season?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, I come like David — no excuses, just a broken and contrite heart. Create in me a pure heart, renew my spirit, and restore to me the joy of Your salvation. Amen.

_May the joy of your salvation be restored to you in full measure._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Psalm 51; 2 Samuel 12:1–13'),
  (4, 1, 'scripture', 'Today''s Reading', '1 Timothy 1:15–16', '“Here is a trustworthy saying… Christ Jesus came into the world to save sinners — of whom I am the worst. But for that very reason I was shown mercy so that in me… Christ Jesus might display his immense patience as an example.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Paul never sanitized his past: he had hunted Christians, approved executions, torn families apart. Yet listen to how he understood his own story — I was shown mercy so that Christ might display his immense patience as an example. Read that again: God made Paul''s forgiven past into a public exhibit — Exhibit A of how much patience Christ carries. The worse the record, the brighter the mercy that covers it. This reframes your history entirely. Your forgiven failure is not the thing you hide; it is the thing heaven displays. Somebody in your future needs to know that a person can fall exactly where you fell and rise by grace. Your testimony is their permission slip.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— What part of your story have you been hiding that heaven may want to display?

— Who might find their hope inside your testimony?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, make my forgiven past an exhibit of Your patience. I will stop editing my story and start testifying to Your mercy. Use it to unlock someone else''s hope. Amen.

_May your scars become somebody''s map to mercy._'),
  (4, 5, 'reading', 'Go Deeper', NULL, '1 Timothy 1:12–17; Acts 9:1–22'),
  (5, 1, 'scripture', 'Today''s Reading', '1 Samuel 12:20', '“Do not be afraid. You have done all this evil; yet do not turn away from the Lord, but serve the Lord with all your heart.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Israel had just committed a national failure — rejecting God''s kingship and demanding a human king. Samuel does not minimize it: “You have done all this evil.” And then comes one of the most beautiful words in Scripture: yet. Yet do not turn away. Yet serve the Lord with all your heart. Notice the direction of the instruction: failure tempts us to run from God in shame, when grace invites us to run to Him in service. The devil''s masterpiece is convincing a fallen believer that distance is humility. It is not; it is defeat. Whatever your “all this evil” is, heaven has attached a “yet” to it. The way back is not a long probation. It is a turned heart, today.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Has shame been dressing itself up as humility in your life — keeping you distant from God?

— What would "serving the Lord with all your heart" look like, starting this week?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, I hear the "yet" over my failure. I refuse the false humility of distance. I turn — not away from You, but toward You — and I give You my whole heart''s service. Amen.

_May the word "yet" be written by God over every failure in your story._'),
  (5, 5, 'reading', 'Go Deeper', NULL, '1 Samuel 12:19–25'),
  (6, 1, 'scripture', 'Today''s Reading', '2 Corinthians 12:9', '“But he said to me, “My grace is sufficient for you, for my power is made perfect in weakness.” Therefore I will boast all the more gladly about my weaknesses, so that Christ’s power may rest on me.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Paul asked three times for his weakness to be removed. Heaven answered with something better than removal: sufficiency. My grace is sufficient for you — present tense, permanent supply. Then comes the sentence that turns human thinking upside down: God''s power is made perfect in weakness. Not despite it — in it. The crack in your jar is where the treasure shines through (2 Corinthians 4:7). The world builds platforms out of strength; God builds testimonies out of dependence. So the weakness you have begged God to delete may be the very stage He intends to stand on. Stop negotiating with your thorn long enough to notice the grace growing beside it.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— What weakness have you asked God to remove that He may intend to inhabit?

— How would you live differently if dependence were a qualification, not a defect?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Lord, Your grace is sufficient for me — for this thorn, this weakness, this day. Let Your power rest on the cracked places of my life and shine through them. Amen.

_May Christ''s power rest visibly on your weakest place._'),
  (6, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 12:7–10; 4:7–9'),
  (7, 1, 'scripture', 'Today''s Reading', 'John 21:9, 12', '“When they landed, they saw a fire of burning coals there with fish on it, and some bread… Jesus said to them, “Come and have breakfast.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Peter denied Jesus three times beside a charcoal fire. After the resurrection, Jesus built another charcoal fire — and cooked him breakfast beside it. Read that slowly: the Lord of glory made food for the man who had disowned Him. Then, three times — once for each denial — Jesus asked, “Do you love me?” and three times He answered Peter''s yes with commission: feed my sheep. He did not re-try the case. He re-issued the calling. This is how Christ handles your failure: not with a tribunal, but with a table. And notice what restoration produced — fifty days later, the denier preached and three thousand were saved. Your restoration is never only about you; sheep are waiting on the other side of it.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Where do you need to hear "Come and have breakfast" instead of "Explain yourself"?

— What calling might Jesus be re-issuing to you right now?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, I come to Your fire — the one with breakfast on it. I answer Your question: You know that I love You. Re-issue my calling, and I will feed Your sheep. Amen.

_May you smell breakfast, not judgment, when you come back to His fire._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'John 21:1–19; Luke 22:31–32'),
  (8, 1, 'scripture', 'Today''s Reading', 'Philippians 3:13–14', '“But one thing I do: Forgetting what is behind and straining toward what is ahead, I press on toward the goal to win the prize for which God has called me heavenward in Christ Jesus.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Shame is a rehearsal artist. It replays the failure in high definition, night after night, until the past feels more real than the future. Paul — who had more to replay than most — announces his deliberate policy: forgetting what is behind. Biblical forgetting is not amnesia; Paul could still list his past when it served the gospel. It is de-throning — refusing to let yesterday govern today. You cannot drive forward staring into the mirror, and the devil knows it; that is why he keeps polishing the glass. You cannot change the past, and the enemy knows that too — it is precisely why he keeps you facing it. But what God is working on is your future. Cut off your past and march forward.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Which scene does shame replay most often — and what does it cost you to keep watching it?

— What is the "one thing" ahead that deserves the energy the past has been consuming?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, I resign as curator of the museum of my failures. I forget what is behind — I de-throne it — and I strain toward what You have called me to. Point my eyes forward. Amen.

_May your windscreen finally grow larger than your mirror._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Philippians 3:4–14; Isaiah 43:18–19'),
  (9, 1, 'scripture', 'Today''s Reading', 'Luke 15:20', '“But while he was still a long way off, his father saw him and was filled with compassion for him; he ran to his son, threw his arms around him and kissed him.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'The prodigal rehearsed a speech on the road home — a proposal for demotion: make me like one of your hired servants. He had done the mathematics of his failure and calculated his reduced worth. He never finished the speech. The father was running before the boy could present his terms — robe, ring, sandals, feast. In a Middle Eastern village, patriarchs did not run; this father gathered his robes and sprinted, absorbing the village''s shame so his son would not have to walk through it alone. That is your God. While you are still rehearsing your demotion speech, He is already in motion. Grace does not meet you halfway. It outruns you.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— What "demotion speech" have you been rehearsing before God?

— Can you let yourself be celebrated — robe and ring — rather than merely tolerated?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, I drop my speech. I receive the robe I did not earn, the ring I do not deserve, and the embrace that outran my repentance. I come home as a child, not an employee. Amen.

_May you hear running footsteps every time you turn toward home._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Luke 15:11–32'),
  (10, 1, 'scripture', 'Today''s Reading', 'Jonah 3:1–2', '“Then the word of the Lord came to Jonah a second time: “Go to the great city of Nineveh and proclaim to it the message I give you.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Jonah ran from his assignment — in the opposite direction, by ship, into a storm, into a fish. If anyone had forfeited his calling, surely it was the prophet found sleeping in the cargo hold of his own disobedience. Then comes the quietest miracle in the book: the word of the Lord came a second time. Same commission. Same city. Same God — undeterred. And when Jonah finally preached, an entire city repented; his greatest ministry stood on the far side of his greatest failure. This is your commissioning day. The God of second words is speaking again. Steward this new grace: walk humbly, keep short accounts, extend to others the mercy you have received — and go to your Nineveh.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— What assignment is God re-issuing to you "a second time"?

— Who needs from you the same mercy these ten days have shown you?'),
  (10, 4, 'devotional', 'Pray', NULL, 'God of the second word, I hear You. I rise from the ash of my failure and I go where You send me. Make my life a testimony that Your mercies are new every morning. Amen.

_May the word of the Lord come to you a second time — and may you run toward it, not away._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Jonah 1–3; Micah 7:8, 18–19')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- built-to-last (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('built-to-last', 'Built to Last', 'Ten days of holy discipline', 'Everybody has January dreams. Very few have December harvests. The difference is never information — we all know what we should do. The difference is a bridge called discipline, and most of us have admired the river instead of building the bridge. This plan is honest about human nature: motivation is weather — it visits and leaves. Discipline is climate. For ten days we will sit with Daniel, with Paul, with the athletes of Corinth and the sluggard''s field of Proverbs, and we will build — one small permanent decision at a time. Not harsh self-punishment; holy discipline, the kind Scripture says yields “a harvest of righteousness and peace for those who have been trained by it.” Bring one area of your life you are tired of restarting. We will finish what you keep beginning.', 'Discipleship', 10, 10, 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
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
  (1, 1, 'scripture', 'Today''s Reading', 'Proverbs 13:4', '“A sluggard’s appetite is never filled, but the desires of the diligent are fully satisfied.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Vision without discipline is a wish. Between what God has shown you and what you actually become stands a bridge, and the name of that bridge is discipline. Grace supplies the power — but discipline positions you under the tap. Notice what the proverb does not say. It does not say the sluggard has no appetite; his appetite is enormous. Desire is not the difference between people — everybody desires. Diligence is the difference. Two people can hear the same sermon, receive the same promise, carry the same gifting, and arrive at two different lives: one built the bridge, the other admired the river. Today, name the river. What has God shown you that you keep looking at from the wrong bank?'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What vision have you been admiring for years without building toward it?

— Where in your life is appetite pretending to be commitment?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Father, forgive me for mistaking desire for diligence. I choose today to stop admiring the river. Show me the first plank of the bridge, and give me the grace to lay it. Amen.'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 13:4; James 1:22–25'),
  (2, 1, 'scripture', 'Today''s Reading', 'Luke 16:10', '“Whoever can be trusted with very little can also be trusted with much.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Motivation visits you on the first of January and is gone by February. It is weather — beautiful, unreliable, and never in charge of the harvest. Discipline is climate: the settled pattern that decides what can actually grow in your life. This is why the enemy is not threatened by your resolutions; he has watched thousands of them die of natural causes. He is threatened by your habits — the decisions that have stopped asking your feelings for permission. Jesus builds His economy on this principle: faithfulness in the very little is the qualifying exam for the much. Not brilliance in the very little. Not passion in the very little. Faithfulness — showing up when the weather is bad. Start smaller than you think you should, but start permanently.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Which resolution do you keep restarting — and what feeling does it always wait for?

— What is the smallest version of that discipline you could keep even on your worst day?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Lord, I resign from the weather of motivation and enrol in the climate of discipline. Teach me faithfulness in the very little, and trust me, in time, with the much. Amen.'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Luke 16:10–12; Zechariah 4:10'),
  (3, 1, 'scripture', 'Today''s Reading', 'Daniel 1:8', '“But Daniel purposed in his heart that he would not defile himself.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Daniel was a teenager, a captive, in a foreign empire designed to erase his identity — new name, new language, new food, new gods. And the Scripture records his secret in five words: he purposed in his heart. Notice where the decision happened: in the heart, before the test. Discipline that is negotiated at the moment of temptation always loses; the buffet is not the place to decide you are fasting. Daniel decided once, in private, and then enforced that single decision daily for decades. Psychologists call it pre-commitment; Scripture has taught it for millennia. The men and women who become do not make a hundred decisions a day — they make a few decisions once, and then keep them. What do you need to settle tonight, before the next test finds you undecided?'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Which recurring temptation finds you undecided every single time?

— What one decision could you make once — tonight — that would end a hundred daily battles?'),
  (3, 4, 'devotional', 'Pray', NULL, 'God of Daniel, I come to make decisions in the quiet, before the noise. Tonight I purpose in my heart. Hold me to it when the empire sets its table in front of me. Amen.'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Daniel 1:3–21'),
  (4, 1, 'scripture', 'Today''s Reading', 'Daniel 6:10', '“Three times a day he got down on his knees and prayed, giving thanks to his God, just as he had done before.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Read the last five words again: just as he had done before. The lions'' den did not find Daniel improvising an emergency altar. It found a man whose knees had a schedule — a prayer habit so established that not even a death decree could interrupt it. Here is the sobering truth about crisis: it does not build character; it reveals the habits you brought into it. The storm is a terrible time to learn to build. Whatever you do daily is quietly becoming your strength — or your absence of it. Your habits are prophecies. Show me what you do every day and I will show you what you are becoming. Give your knees a schedule now, and the den will find you already strong.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— If a crisis hit this week, what habits would it find already in place?

— What time and place will you give your knees, starting tomorrow?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, before the den, before the decree, before the crisis — establish my altar. Give my knees a schedule and my soul a rhythm that trouble cannot interrupt. Amen.'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Daniel 6:1–23; Psalm 55:17'),
  (5, 1, 'scripture', 'Today''s Reading', '1 Corinthians 9:25', '“Everyone who competes in the games goes into strict training. They do it to get a crown that will not last; but we do it to get a crown that will last forever.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Paul wrote to a city that hosted the games, and he pointed at the athletes: look at what people will endure for a leaf crown that withers in a week. Dawn training. Strict diets. Years of obscurity for minutes of competition. Then he turned the comparison on us: we run for a crown that lasts forever — shall the eternal be pursued with less seriousness than the temporary? Then the apostle gives his own testimony, and it should stop us: I discipline my body and bring it into subjection. The greatest missionary in history did not trust his calling to exempt him from training. Gifting is never a substitute for governance of the self. Your body is not the enemy — but it is a terrible master and an excellent servant. Decide daily which one it will be.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Where does your body currently give the orders — sleep, food, comfort, screens?

— What would "strict training" look like for your eternal crown, this month?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Lord, I refuse to be disqualified by an ungoverned self. I present my body as a living sacrifice — a servant of the call, not its master. Train me like an athlete of the Kingdom. Amen.'),
  (5, 5, 'reading', 'Go Deeper', NULL, '1 Corinthians 9:24–27; Romans 12:1'),
  (6, 1, 'scripture', 'Today''s Reading', 'Proverbs 24:30–31', '“I went past the field of a sluggard… thorns had come up everywhere, the ground was covered with weeds, and the stone wall was in ruins.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Nobody plants thorns. Read that field carefully: the sluggard never decided to ruin it. No dramatic rebellion, no great collapse — just “a little sleep, a little slumber, a little folding of the hands,” repeated. Failure needs no plan; it is the natural harvest of small neglects, compounded daily. This is both a warning and a hope. The warning: the wall around your marriage, your health, your walk with God is not usually demolished — it is neglected, one skipped day at a time, until a stranger walks through the gap. The hope: if small neglects compound, so do small faithfulnesses. The same mathematics that ruins a field can grow one. You do not need a dramatic turnaround today. You need to repair one stone in the wall — and come back tomorrow.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Which wall in your life has been quietly losing stones?

— What is one stone you can put back today — one call, one page, one prayer, one apology?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, open my eyes to the gaps in my walls before the thorns fill the field. I renounce the "little by little" of neglect and I embrace the "little by little" of faithfulness. Amen.'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 24:30–34; Song of Songs 2:15'),
  (7, 1, 'scripture', 'Today''s Reading', 'Proverbs 4:23', '“Above all else, guard your heart, for everything you do flows from it.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Every farmer knows: whatever feeds your field is farming your field. Your mind has gates — your eyes, your ears, your company — and whatever passes through them daily is planting something. Much of what we call weakness of willpower is really carelessness at the gates: we lose the battle at the point of intake, then wonder why we lose it at the point of action. Discipline, then, is not only about what you make yourself do; it is about what you let yourself see and hear. What you focus on multiplies. The news you consume, the voices you platform in your life, the content you scroll at midnight — these are seeds, and every seed produces after its kind. Post a gatekeeper. Be as deliberate about your inputs as you have tried to be about your outputs, and the outputs will begin to obey.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Which gate is least guarded in your life — eyes, ears, or company?

— What one input will you cut this week, and what will you plant in its place?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Lord, I station a watchman at the gates of my heart. Guard my eyes, my ears and my companions. Let only what serves my becoming pass through — and let it multiply. Amen.'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 4:20–27; Psalm 101:2–3'),
  (8, 1, 'scripture', 'Today''s Reading', 'Joshua 1:8', '“Keep this Book of the Law always on your lips; meditate on it day and night… Then you will be prosperous and successful.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'God gave Joshua the largest assignment of his generation — and one instruction for succeeding at it. Not networking. Not talent. Meditation on the Word, day and night. Heaven attached “prosperous and successful” to a reading habit. Meditation is to the mind what digestion is to the body. Reading passes food across the plate; meditation absorbs it into the bloodstream. This is why a man can read a whole chapter and remain unchanged, while another man carries one verse through his day like a sweet in his mouth — and is transformed. Read, think; read, ponder; squeeze the virtue of what you read like juice from an orange. If you read today, it will show tomorrow. If you don''t read today — that will also show tomorrow.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Is the Word currently on your plate or in your bloodstream?

— What single verse will you carry through tomorrow, from morning to night?'),
  (8, 4, 'devotional', 'Pray', NULL, 'God of Joshua, make Your Word my daily bread and my nightly meditation. Let it move from my eyes to my mouth to my bloodstream, until my life prospers from the inside out. Amen.'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Joshua 1:6–9; Psalm 1:1–3'),
  (9, 1, 'scripture', 'Today''s Reading', 'Proverbs 3:9', '“Honor the Lord with your wealth, with the firstfruits of all your crops.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Some disciplines are visible — people see you rise early, train hard, show up. But the disciplines that shape a destiny most deeply are the ones nobody applauds: giving when no one is watching, resting when hustle is idolized, staying honest when a shortcut is available and profitable. Giving is a discipline of the heart''s grip — it pries your fingers off provision and fixes them on the Provider. The firstfruits principle is not God needing your money; it is God healing your trust. Rest is a discipline of humility: the man who cannot stop is quietly confessing that he believes the world is held up by his effort. Even Jesus said, “Come with me by yourselves to a quiet place and get some rest.” Practice one hidden discipline this week. Heaven applauds what nobody sees — and “your Father, who sees what is done in secret, will reward you.”'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Which hidden discipline is weakest in your life — giving, rest, or hidden integrity?

— What will you do this week in secret, for an audience of One?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, wean me off applause. Build in me the hidden disciplines — the open hand, the trusting rest, the honest ledger — and reward them not with attention, but with becoming. Amen.'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Matthew 6:1–6; Mark 6:30–32'),
  (10, 1, 'scripture', 'Today''s Reading', 'Hebrews 12:11', '“No discipline seems pleasant at the time, but painful. Later on, however, it produces a harvest of righteousness and peace for those who have been trained by it.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Daniel served at the top of three empires — Babylon fell, Media rose, Persia followed, and Daniel remained. Regimes change; discipline survives regimes. That is what you have been building for ten days: not a burst of effort, but a culture — a way of living repeated until it becomes a nature. Read today''s verse honestly: discipline is painful, and Scripture does not pretend otherwise. But the verse contains a harvest, and the harvest has a condition — it comes “to those who have been trained by it.” Not visited by it. Trained by it. So do not close this plan the way you close a book. Choose your daily disciplines — the Word, prayer, your craft, your body, your giving — and keep them on the days you feel nothing. The harvest is not watching your feelings. It is watching your training.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Which two disciplines from these ten days will become your permanent culture?

— Who will you invite to keep you accountable — iron sharpening iron?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Lord, let discipline stop being an event in my life and become a culture. Train me. And in the season of harvest, let righteousness and peace testify that I did not quit. Amen.'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Hebrews 12:7–13; Galatians 6:9 The harvest of these ten days will not appear in ten days — that is exactly the point. Keep training. This plan is drawn from The Power to Become by Moses Mwicigi, where discipline joins vision, identity and destiny in the full journey of becoming.')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
DELETE FROM reading_plans WHERE code IN ('first-steps', 'who-am-i', 'where-did-i-come-from', 'healed-of-rejection', 'fear-not', 'new-grace', 'built-to-last');
