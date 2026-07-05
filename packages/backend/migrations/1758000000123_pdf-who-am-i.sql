-- Who Am I?: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
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
  (1, 1, 'scripture',  'Today''s Reading', 'Psalm 8:4', $dev$“What is mankind that you are mindful of them, human beings that you care for them?”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,     $dev$It is much easier to define other people than to define ourselves. Ask someone to describe their friend and words flow freely; ask them to describe themselves and the room goes quiet. Psychologists call it self-opacity — we are the one person we never see from the outside. The Psalmist felt it too, standing under a night sky: what is mankind?

Here is where this journey begins: the confusion you feel about yourself is not evidence that you are nothing. It is evidence that you are deep — deep enough that only your Maker holds the full description. A product is never explained by the shelf it sits on; it is explained by its manufacturer.

For the next ten days, stop asking the mirror. Start asking the Maker.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,     $dev$— If a stranger asked you "who are you?" — and your job, family roles and achievements were off-limits — what would you say?

— When did you last feel truly sure of who you are? What changed?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I bring You the question I have carried silently for years: who am I? I have asked mirrors, people and achievements, and their answers did not hold. For the next ten days, I am asking You. Speak, Lord. Amen.

_May the Maker’s answer begin to quiet every question the mirror ever asked you._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,     $dev$Psalm 8; Psalm 139:1–6$dev$),

  (2, 1, 'scripture',  'Today''s Reading', 'Luke 12:15', $dev$“Watch out! Be on your guard against all kinds of greed; life does not consist in an abundance of possessions.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,     $dev$Some people never discover who they are because failure blinds them. But hear a stranger warning: many more are blinded by success. When applause is loud enough, you stop asking questions. Why examine your identity when your results keep telling you that you are fine?

Yet you can be performing better than everyone around you and still be operating far below your own potential. That is not success; that is failure wearing a garland. Comparison anaesthetizes us — it measures us against the people nearby instead of the purpose we were made for.

Jesus told of a rich man whose barns were full while heaven called him a fool — full barns, unopened book. Do not let what you have achieved talk you out of discovering who you are.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Where has doing well quietly replaced knowing who you are?

— Whose applause are you most afraid to lose — and what has it cost you?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,     $dev$Lord, I refuse to let my achievements answer a question only You can answer. Deliver me from the anaesthesia of applause and comparison. Measure me by the book You wrote about me, not by the people around me. Amen.

_May applause never again decide the value heaven already settled._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 12:13–21; 2 Corinthians 10:12$dev$),

  (3, 1, 'scripture',  'Today''s Reading', 'Galatians 1:10', $dev$“Am I now trying to win the approval of human beings, or of God? … If I were still trying to please people, I would not be a servant of Christ.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,     $dev$We live in the first generation in history that carries a stage in its pocket. Every day, millions polish an image of a person who does not exist, and then feel crushed when reality cannot keep up with the profile. People's true value and authenticity are being washed away in the pursuit of imitating their idols.

Imitation is the sincerest form of self-abandonment. Every hour spent becoming a copy of someone else is an hour your true self goes unlived. And here is the psychology of it: we imitate because we fear that who we actually are is not enough. The gospel breaks that fear at the root — the God who had every option available made you on purpose, in His own image, and He does not create surplus people.

You were never designed to trend. You were designed to become.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Who are you tempted to imitate — and what do you secretly believe they have that you lack?

— What part of the "image" you present to others is furthest from the truth?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,     $dev$Father, forgive me for auditioning for people when I was already accepted by You. I lay down the exhausting work of being someone else. Teach me to be fully, courageously the person You made. Amen.

_May you retire tonight from every audition you were never meant to attend._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,     $dev$Galatians 1:10; 1 Samuel 16:7$dev$),

  (4, 1, 'scripture',  'Today''s Reading', 'Acts 17:26', $dev$“From one man he made all the nations, that they should inhabit the whole earth; and he marked out their appointed times in history and the boundaries of their lands.”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,     $dev$You cannot know who you are until you know where you came from. Paul told the philosophers of Athens that every nation on earth came from one man — one blood. Beneath every tribe, class and passport, humanity shares a single origin, and that origin bears the image of God.

This truth does two surgeries at once. It removes inferiority: no one on earth is made of better material than you. And it removes superiority: no one is made of worse. The ground at the foot of the cross — and at the gate of identity — is perfectly level.

Notice something else in the verse: God marked out your appointed time and your boundaries. You were not born in the wrong country, the wrong family or the wrong century. Your origin was planned by a meticulous God who keeps records.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Have you treated your background — family, tribe, class — as a verdict on your worth?

— What changes if your birthplace and birth-time were appointments, not accidents?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,     $dev$God of all flesh, thank You that I come from You before I come from anyone else. Heal every place where my background has spoken louder than my origin. I accept my appointed time and my ground. Amen.

_May the level ground of one blood heal every ranking in your heart._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,     $dev$Acts 17:24–28; Genesis 1:26–28$dev$),

  (5, 1, 'scripture',  'Today''s Reading', '2 Corinthians 3:18', $dev$“And we all, who with unveiled faces contemplate the Lord’s glory, are being transformed into his image with ever-increasing glory.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,     $dev$Every mirror you have ever consulted was cracked. The mirror of other people's opinions bends with their moods. The mirror of your feelings changes with your sleep, your hunger, your losses. Even the mirror of your successes shows you only what you have done, never who you are.

There is one uncracked mirror: Jesus Christ. He is the exact image of the invisible God — and therefore the truest picture of what a human being was always meant to be. To know who you are, look long at who He is. We do not find ourselves by gazing inward; we find ourselves by gazing upward, and the Scripture promises that what we behold, we become.

Identity, it turns out, is not archaeology — digging into yourself. It is photography — long exposure to the light of His face.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Which cracked mirror do you consult most often — opinions, feelings, or achievements?

— What would "long exposure" to Jesus practically look like in your week?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, perfect image of God, I turn from the cracked mirrors. As I behold You in Your Word, transform me from one degree of glory to another, until I resemble the person heaven already sees. Amen.

_May long exposure to His face begin to develop in yours._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,     $dev$2 Corinthians 3:12–18; Colossians 1:15$dev$),

  (6, 1, 'scripture',  'Today''s Reading', 'John 1:12', $dev$“Yet to all who did receive him, to those who believed in his name, he gave the right to become children of God.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,     $dev$Notice the wording: the right to become. Not a feeling, not a wish — a legal right, conferred by the highest court in existence. When you received Christ, your identity changed at the level of paperwork in heaven: a birth certificate, not a membership card.

Psychology tells us that a child's sense of self is built first from the face of a parent — we learn who we are from how we are looked at. Many of us are still living out of distorted faces: the absent father, the harsh critic, the one who never noticed. Today the gospel offers you a new face to grow up under. Your Father in heaven looks at you and is not disappointed; the Spirit in you cries “Abba” — the sound of a child utterly at home.

You are no longer a slave auditioning for a place. You are a child who owns one.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Whose face taught you who you are — and what did it teach you?

— What would you attempt this year if you were certain the Father delights in you?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,     $dev$Abba Father, I receive the right to be called Your child. Where other faces wrote lies on my identity, write Your truth. Let my heart settle into the confidence of a loved son, a loved daughter. Amen.

_May you fall asleep tonight the way a loved child does — utterly at home._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,     $dev$John 1:12–13; Romans 8:14–17$dev$),

  (7, 1, 'scripture',  'Today''s Reading', 'John 15:15', $dev$“I no longer call you servants… Instead, I have called you friends, for everything that I learned from my Father I have made known to you.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,     $dev$Being a child speaks of belonging. Friendship speaks of something even more surprising: access. Jesus defines His friendship by disclosure — everything I learned from my Father I have made known to you. Friends are the people we tell things.

Loneliness is one of the deepest wounds of our generation; we are the most connected and least known people in history. Into that ache, the Son of God says: I call you friend. Not fan. Not follower. Friend — someone He confides in, someone He wants at the table, someone whose company He chose when He chose the twelve “that they might be with him.”

An identity built on His friendship cannot be dismantled by anyone's rejection. People may leave your table. He never leaves His — and your seat has your name on it.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Do you relate to Jesus as staff or as friend? What is the difference in practice?

— What is He making known to you in this season that you have been too busy to hear?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, thank You for calling me friend. Teach me the rhythms of friendship with You — unhurried time, honest words, shared secrets. Heal what rejection has broken, at the table where I am always welcome. Amen.

_May you find your seat at His table with your name already on it._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,     $dev$John 15:9–17; Exodus 33:11$dev$),

  (8, 1, 'scripture',  'Today''s Reading', 'Judges 5:20', $dev$“From the heavens the stars fought, from their courses they fought against Sisera.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,     $dev$In the song of Deborah, heaven reads out a register: kings came and fought; princes offered themselves willingly; nobles came down; captains carried a commander's staff; villagers arose. And above them all, a rank we forget: the stars fought from their courses. Men are identified by their ranks — yes, men have ranks in the spirit.

You are not a random unit in a crowd of eight billion. In the realm of the spirit you hold a station, a post, an assignment with your name on it. When you were born, it was the rising of a star, and the watchmen of darkness took note; when you were born again, the angels of God rejoiced.

The enemy has never doubted your rank. That is precisely why he works so hard to keep you from discovering it.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Have you been living like a spectator in a realm where heaven lists you as a soldier?

— What might your "post" be — the place where your presence makes darkness nervous?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,     $dev$Lord of hosts, open my eyes to my rank in Your kingdom. May my star be unveiled; may every shroud over my life be removed. I report for the post You assigned me before I was born. Amen.

_May your rank in the spirit become more real to you than any title on earth._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,     $dev$Judges 5:1–31; Daniel 12:3$dev$),

  (9, 1, 'scripture',  'Today''s Reading', 'Romans 8:1', $dev$“Therefore, there is now no condemnation for those who are in Christ Jesus.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,     $dev$Identity is not only discovered; it is declared. Your life moves in the direction of your words, and many of us have spent years prophesying against ourselves — I am a failure, I am always late, I am not enough. Today, we change what the court hears.

Read these aloud. Slowly. Your own ears need to hear your own mouth agree with heaven: I am a child of God (John 1:12). There is no condemnation for me (Romans 8:1). I am a friend of Jesus (John 15:15). I am a new creation (2 Corinthians 5:17). I am God's workmanship (Ephesians 2:10). I am a royal priesthood (1 Peter 2:9). I am more than a conqueror (Romans 8:37). I am the light of the world (Matthew 5:14). I am Christ's ambassador (2 Corinthians 5:20). I am complete in Him (Colossians 2:10).

Ten declarations. Heaven stands behind every one.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Which declaration was hardest to say aloud — and what does that reveal?

— What have you been habitually saying about yourself that heaven never said?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,     $dev$Father, put Your words in my mouth about my own life. Where I have agreed with the accuser, I now agree with You. I will say who I am until I see who I am. Amen.

_May your own ears believe your mouth as it agrees with heaven._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,     $dev$Romans 8:31–39; Proverbs 18:21$dev$),

  (10, 1, 'scripture',  'Today''s Reading', 'Ephesians 2:10', $dev$“For we are God’s handiwork, created in Christ Jesus to do good works, which God prepared in advance for us to do.”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,     $dev$Identity is never given for decoration; it is given for deployment. God does not tell you who you are so you can frame it — He tells you who you are so you can spend it. You are His workmanship, and the works were prepared before you were.

This is where the mirror question finally comes to rest. Who am I? I am a child of the Father, a friend of Jesus, made from one blood, carrying a rank in the spirit, with a book in heaven and works prepared in advance for my hands. The question that once haunted you becomes the commission that sends you.

Ten days ago you stood at the mirror. Today, walk away from it — not because the question no longer matters, but because it has been answered by Someone whose answers do not change.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What "good works prepared in advance" might already be within reach of your hands?

— How will you answer differently, the next time life asks who you are?$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,     $dev$Lord, thank You for answering the question of my life. Now send me. Let my unshakable identity become unstoppable assignment, and let the world around me benefit from who You made me to be. Amen.

_May the answered question become an unstoppable assignment._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,     $dev$Ephesians 2:1–10; Jeremiah 1:5$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
