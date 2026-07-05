-- Reseed who-am-i with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional',       NULL,     $dev$Ask someone to describe their closest friend and the words pour out — their humour, their strengths, the little flaws they would never admit to. Ask that same person to describe themselves, and the room goes quiet. It is one of the strangest facts of being human: you are the one person you will never see from the outside. We can read a whole crowd and still misread the face in the mirror.

The Psalmist felt that vertigo too. David is not indoors when he writes Psalm 8; he is outside under a sky thick with stars, and the sheer scale of it presses a question out of him — what is mankind that you are mindful of them? It is not a cry of despair. Look at the shape of the sentence: the smallness of man is measured against the mindfulness of God. David is not asking who he is in the dark. He is asking it in the light of the One who made him.

That is the hinge this whole journey turns on. The confusion you feel about yourself is not proof that you are nothing; it is proof that you are deep — deep enough that only your Maker holds the full description. A product is never truly explained by the shelf it sits on, or by the shoppers who pick it up and put it down. It is explained by the one who designed it. You have been handing the question to the wrong authorities.

So for the next ten days, change who you ask. Stop interrogating the mirror, which only shows you a surface. Stop polling the crowd, whose opinions shift with their moods. Bring the question — quietly, honestly — to the God who was thinking of you before you could think at all.

You are not lost. You are simply asking in the wrong room.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,     $dev$— If a stranger asked "who are you?" and your job, your family roles and your achievements were all off-limits, what would honestly be left to say?

— When did you last feel truly sure of who you are — and what happened to shake it loose?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I bring You the question I have carried silently for years: who am I? I have asked mirrors, people and achievements, and their answers never held their shape for long. For the next ten days I am done asking them — I am asking You. Speak, Lord; Your servant is listening. Amen.

_May you carry the question gently today, knowing the One who holds the answer is already mindful of you._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,     $dev$Psalm 8; Psalm 139:1–6$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Luke 12:15', $dev$“Watch out! Be on your guard against all kinds of greed; life does not consist in an abundance of possessions.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,     $dev$Some people never discover who they are because failure has blinded them. But here is the more dangerous blindness, the one nobody warns you about: success. When the applause is loud enough, you simply stop asking questions. Why examine your identity when your results keep reassuring you that you are fine?

Jesus tells the story of a man like that. His land produced so well that his old barns could not hold it, so he made bigger ones and settled back to enjoy the harvest of a lifetime. Every visible measure said he had arrived. And then, mid-celebration, heaven speaks a single devastating word over him: “You fool.” Full barns, and an unopened book. He had solved the question of storage and never touched the question of self.

Notice what Jesus puts His finger on — greed, yes, but underneath it a quieter lie: that life consists in the abundance of possessions. That an accumulating outside proves a settled inside. It does not. You can be outperforming everyone in the room and still be living far below the person God made you to be. That is not success; that is failure wearing a garland, and comparison is the drug that keeps you from noticing. Comparison measures you against the people nearby instead of the purpose you were built for, and near the wrong people almost anyone can feel like enough.

So today, be suspicious of your own good news. Let your wins congratulate you without letting them silence you. The barns are not the point. The book God wrote about your life is still waiting to be opened, and no harvest, however large, can answer the question of who you are.

Do not let what you have achieved talk you out of discovering what you were made for.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Where has "doing well" quietly stood in for "knowing who I am" in your life?

— Whose applause are you most afraid to lose — and what has chasing it already cost you?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,     $dev$Lord, I refuse to let my achievements answer a question only You can answer. Deliver me from the anaesthesia of applause and the fog of comparison. Measure me by the book You wrote about me, not by the crowd standing next to me. Open that book to me, and let me become who I truly am. Amen.

_May your wins bless you today without ever silencing the deeper question God is still answering in you._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 12:13–21; 2 Corinthians 10:12$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Galatians 1:10', $dev$“Am I now trying to win the approval of human beings, or of God? … If I were still trying to please people, I would not be a servant of Christ.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,     $dev$We are the first generation in history to carry a stage in our pockets. Every day millions of us polish an image of a person who does not quite exist — brighter, calmer, more admired — and then feel quietly crushed when the ordinary reality of Monday morning cannot keep up with the profile we posted on Sunday.

Paul knew nothing of screens, but he knew this pull exactly. In Galatians he is under pressure to soften his message so the influential crowd will approve of him, and he draws a line in the sand: am I trying to win human approval, or God's? He sees clearly what we often miss — you cannot be a servant of Christ and an auditioner for the crowd at the same time. One of those masters has to lose. The applause of people and the approval of God are pulling your life in two different directions.

Here is the psychology underneath the imitation: we copy the people we envy because, deep down, we fear that who we actually are is not enough. So we borrow their look, their opinions, their life, and every hour spent becoming a copy is an hour our own self goes unlived. Imitation is the sincerest form of self-abandonment. But the gospel cuts that fear at the root. The God who had every option in existence available to Him made you — deliberately, in His own image (Genesis 1:27) — and Scripture is blunt that He does not judge by the polished surface but by the heart He can already see (1 Samuel 16:7). Heaven does not manufacture surplus people, and it does not grade on the curve of the trending.

So put down the audition today. You were not designed to trend; trends are forgotten by next season. You were designed to become — and becoming is the one thing a copy can never do.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Who are you most tempted to imitate — and what do you secretly believe they have that you lack?

— Which part of the image you present to others sits furthest from the truth of who you really are?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,     $dev$Father, forgive me for auditioning for people when I was already accepted by You. I lay down the exhausting work of being someone else — the borrowed opinions, the polished image, the constant glancing at the crowd. Teach me to be fully, courageously the person You had in mind when You made me. Amen.

_May you spend today being becomingly yourself, and find it is more than enough._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,     $dev$Galatians 1:10; 1 Samuel 16:7$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Acts 17:26', $dev$“From one man he made all the nations, that they should inhabit the whole earth; and he marked out their appointed times in history and the boundaries of their lands.”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,     $dev$You cannot fully know who you are until you know where you came from. Cut off from its source, a river is only a puddle waiting to dry. And most of us have been reading our origins off the wrong document — a family name, a village, a bank balance, a passport — and then living down to whatever that document seemed to say about us.

Paul stands in Athens, the most sophisticated city of his day, surrounded by philosophers who divided the world neatly into Greeks and barbarians, the civilised and the rest. Into that room he drops a sentence that levels it: from one man He made all the nations. One blood. Beneath every tribe, class and border, the whole human family shares a single origin — and that origin bears the image of God (Genesis 1:26). The Athenian and the outsider came from the same source.

That truth performs two surgeries in the same moment. It removes inferiority: there is no one on earth made of finer material than you — not the wealthy, not the famous, not the ones your culture taught you to look up to. And it removes superiority: no one is made of lesser material either, however your background may have ranked them beneath you. The ground at the foot of the cross, and at the gate of your identity, is perfectly level. But read the verse to its end, because it says more — God marked out your appointed times and the boundaries of your lands. You were not born in the wrong country, the wrong family, or the wrong century by some cosmic slip. Your coordinates were set by a meticulous God who keeps records and makes no accidental placements.

So stop apologising for where you started. Your background is not the verdict on your worth. Your origin is — and your origin is God.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Have you treated your background — family, tribe, class, hometown — as a verdict on your worth?

— What changes in you if your birthplace and your birth-time were appointments God made, not accidents that happened to you?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,     $dev$God of all flesh, thank You that I come from You before I come from anyone or anywhere else. Heal every place where my background has spoken louder than my origin. I accept my appointed time and my appointed ground — not as a sentence, but as a setting You chose for me. Amen.

_May you stand on your own ground today knowing a careful God set your feet there on purpose._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,     $dev$Acts 17:24–28; Genesis 1:26–28$dev$),
  (5, 1, 'scripture',  'Today''s Reading', '2 Corinthians 3:18', $dev$“And we all, who with unveiled faces contemplate the Lord’s glory, are being transformed into his image with ever-increasing glory.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,     $dev$Every mirror you have ever consulted about yourself was, in some way, cracked. The mirror of other people's opinions warps with their moods and their agendas. The mirror of your own feelings distorts with your sleep, your hunger, your latest loss. Even the mirror of your successes only ever shows you what you have done — never who you are. Consult a broken mirror long enough and you will spend your life correcting a face that was never really yours.

Paul reaches back to a strange scene from Israel's history to make his point. When Moses came down from meeting God, his face shone so brightly that he had to wear a veil; the glory faded, and the veil hid the fading. But now, Paul says, the veil is gone. We come to God with unveiled faces — nothing between us and Him — and we do not gaze at a fading reflection. We contemplate the Lord's glory directly, in the face of Jesus Christ.

And that changes everything, because Christ is the one uncracked mirror. He is the exact image of the invisible God (Colossians 1:15), and therefore the truest picture of what a human being was always meant to be. Here is the promise most of us have missed: as we behold Him, we are transformed into the same image, from one degree of glory to the next. We do not find ourselves by digging inward through our wounds and our moods; identity is not archaeology. We find ourselves by gazing upward, and slowly becoming what we behold. Identity is photography — long, patient exposure to the light of His face.

So this week, ask a simpler question than "who am I?" Ask, "who is He?" — and gaze long enough that His answer starts to develop in you.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Which cracked mirror do you consult most often — other people's opinions, your own feelings, or your list of achievements?

— What would "long exposure" to Jesus practically look like in the ordinary shape of your week?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, perfect image of God, I turn away from the cracked mirrors that have been correcting the wrong face for years. As I behold You in Your Word, transform me from one degree of glory to the next, until I resemble the person heaven already sees when it looks at me. Amen.

_May you become, quietly and steadily this week, whatever you spend your longest looks beholding._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,     $dev$2 Corinthians 3:12–18; Colossians 1:15$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'John 1:12', $dev$“Yet to all who did receive him, to those who believed in his name, he gave the right to become children of God.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,     $dev$Read the wording slowly, because it is doing something enormous: the right to become children of God. Not a feeling. Not a wish. Not a hope you have to keep talking yourself back into. A right — a legal standing, granted and stamped by the highest court in existence. When you received Christ, your identity did not merely improve; it was re-filed. You were issued a birth certificate, not a membership card.

That matters more than it first sounds, because of how a sense of self is actually built. A child learns who they are long before words — from a face. From the way a parent looks at them, lights up or does not, notices or turns away. Many of us are still, decades later, living out of a distorted face: the father who was absent, the critic who was never satisfied, the eyes that always seemed disappointed. And we have quietly assumed that face was telling the truth about us.

John's Gospel offers you a new face to grow up under. In Christ, you are not a servant nervously auditioning for a place in the household — you are a child who already owns one. Paul puts it unforgettably: you did not receive a spirit that makes you a slave again to fear, but the Spirit of adoption, by whom you cry, "Abba, Father" (Romans 8:15). "Abba" is the sound a child makes when it is completely at home — no distance, no performance, no fear of being sent away. When your Father in heaven looks at you now, He is not disappointed. He is delighted.

So today, stop reading your worth off the old faces. You are not a slave hoping to be kept. You are a child who has been given the right to belong — and belonging is not something you can lose by having a bad day.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Whose face first taught you who you are — and what did it teach you to believe about yourself?

— What would you dare to attempt this year if you were fully certain the Father delights in you?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,     $dev$Abba Father, I receive the right to be called Your child — not earned, but given. Where other faces wrote lies onto my identity, write Your truth over them. Let my heart stop auditioning and finally settle into the confidence of a loved son, a loved daughter, fully at home. Amen.

_May you live today out of the delighted face of your Father, not the disappointed faces of your past._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,     $dev$John 1:12–13; Romans 8:14–17$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'John 15:15', $dev$“I no longer call you servants… Instead, I have called you friends, for everything that I learned from my Father I have made known to you.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,     $dev$Yesterday you were told you are a child — and being a child speaks of belonging. Today Jesus offers something even more startling, and He offers it on the last night of His life, hours before the cross: friendship. Not fan. Not follower. Not staff. "I have called you friends." Of all the words the Son of God could have chosen for the people He was about to die for, He chose the warmest one available.

And notice how He defines it. Jesus does not measure friendship by feeling; He measures it by disclosure — "everything that I learned from my Father I have made known to you." Friends are simply the people we tell things to. A servant is kept on a need-to-know basis; a friend is let all the way in. Earlier, when Jesus first called the twelve, Mark tells us His first purpose was startlingly simple: He appointed them "that they might be with him" (Mark 3:14). Before they did a single thing for Him, He wanted their company.

That word lands with unusual weight in our time, because ours may be the loneliest generation ever to live. We are the most connected people in history and among the least known — surrounded by contacts, starved of confidants. Into that specific ache the Son of God says: I call you friend. Someone I confide in. Someone I want at the table. Someone whose company I actually chose. And an identity built on His friendship cannot be dismantled by anyone else's rejection. People may leave your table — some already have. He never leaves His.

So when the loneliness whispers that nobody really knows you, answer it with the truth: One does, completely — and your seat at His table has your name carved into it.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Do you relate to Jesus more like staff or like a friend — and what is the difference in how you actually pray?

— What might He be trying to make known to you in this season that you have been too busy or too guarded to hear?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, thank You for calling me friend when You had every right to call me servant. Teach me the rhythms of friendship with You — unhurried time, honest words, shared secrets, the quiet of just being with You. Heal what rejection has broken in me, at the one table where I am always welcome. Amen.

_May the loneliness lose its voice this week at the table where your seat has always had your name on it._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,     $dev$John 15:9–17; Exodus 33:11$dev$),
  (8, 1, 'scripture',  'Today''s Reading', 'Judges 5:20', $dev$“From the heavens the stars fought, from their courses they fought against Sisera.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,     $dev$In the ancient song of Deborah, heaven reads out a battle register, and it is worth listening to who gets named. Kings came and fought. Princes offered themselves willingly. Nobles came down; captains carried a commander's staff; even the villagers arose. And then, above them all, a rank we tend to skip right over: the stars fought from their courses. The battle against Sisera was fought on two levels at once — on the earth, and in the heavens.

Here is the truth that song is guarding: men have ranks in the spirit. You are not a random, interchangeable unit lost in a crowd of eight billion faces. In the realm of the spirit you hold a station — a post, a course, an assignment with your name written on it, exactly as those stars had theirs. Scripture even promises that the ones who turn many to righteousness will "shine like the stars for ever and ever" (Daniel 12:3). You have a place in that sky.

And both kingdoms have always known it, even when you did not. When you were born, it registered like the rising of a star, and the watchmen of darkness took note. When you were born again, heaven itself threw a party — Jesus said the angels of God rejoice over one sinner who repents (Luke 15:10). The enemy has never once doubted your rank. That is the whole reason he works so relentlessly to keep you feeling ordinary, overlooked, and unaware — because a soldier who does not know he has been commissioned never reports for duty.

So stop living like a spectator in a war where heaven has already listed you among the ranks. You were not born to watch. You were born to take your post.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Have you been living like a spectator in a realm where heaven actually lists you as a soldier with a rank?

— What might your "post" be — the specific place where your presence and prayers make darkness nervous?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,     $dev$Lord of hosts, open my eyes to my rank in Your kingdom. Let my star be unveiled and every shroud over my life be lifted. I stop watching from the sidelines, and I report for the post You assigned to me before I was even born. Amen.

_May you rise today to your post, and may darkness feel it when you do._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,     $dev$Judges 5:1–31; Daniel 12:3$dev$),
  (9, 1, 'scripture',  'Today''s Reading', 'Romans 8:1', $dev$“Therefore, there is now no condemnation for those who are in Christ Jesus.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,     $dev$Identity is not only discovered; at some point it has to be declared. Your life quietly moves in the direction of your words, and if we are honest, many of us have spent years prophesying against ourselves — I am a failure, I always ruin this, I am too much, I am not enough — and then wondering why we keep arriving exactly where our mouths kept sending us.

Today we change what the court of your own heart hears. Because words carry real weight — Scripture says the tongue holds the power of life and death, and we eat its fruit (Proverbs 18:21). Romans 8 begins with a verdict already handed down over you: there is now no condemnation for those who are in Christ Jesus. The accusation has been overruled. So it is time your own mouth caught up with heaven's ruling and stopped rehearsing charges God has already dropped.

Read these aloud. Slowly. Your own ears need to hear your own voice agree with heaven for once. I am a child of God (John 1:12). There is now no condemnation for me (Romans 8:1). I am a friend of Jesus (John 15:15). I am a new creation (2 Corinthians 5:17). I am God's workmanship (Ephesians 2:10). I am a royal priesthood (1 Peter 2:9). I am more than a conqueror (Romans 8:37). I am the light of the world (Matthew 5:14). I am Christ's ambassador (2 Corinthians 5:20). I am complete in Him (Colossians 2:10).

Ten declarations, and heaven stands behind every single one. You are not talking yourself into a fantasy; you are talking yourself out of a lie. Keep saying who you are — out loud, on the hard days especially — until the day you finally see who you are.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Which of those ten declarations was hardest to say aloud — and what does that difficulty reveal about you?

— What have you been habitually saying about yourself that heaven has, in fact, never once said?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,     $dev$Father, put Your words in my mouth about my own life. Where I have quietly agreed with the accuser, I now agree with You instead. There is no condemnation left for me in Christ, so I lay down the charges I kept filing against myself. I will say who I am until I finally see who I am. Amen.

_May your own words begin, at last, to build you up into everything heaven has already declared you to be._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,     $dev$Romans 8:31–39; Proverbs 18:21$dev$),
  (10, 1, 'scripture',  'Today''s Reading', 'Ephesians 2:10', $dev$“For we are God’s handiwork, created in Christ Jesus to do good works, which God prepared in advance for us to do.”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,     $dev$Identity is never given for decoration; it is given for deployment. God does not tell you who you are so you can frame it and admire it on a wall. He tells you who you are so you can spend it. Read the verse to its end and you see it: you are His handiwork, His masterpiece — and the good works were prepared beforehand, waiting like a road already laid, for you to walk in them.

This is where the mirror question finally comes to rest. Ten days ago you stood in front of the glass and asked, who am I? Now gather the answers heaven has been handing you. You are a child of the Father, given the right to belong. A friend of Jesus, let all the way in. Made from one blood, with no one above you and no one beneath. Carrying a rank in the spirit, with a post that has your name on it. Recorded in a book, declared without condemnation, and holding good works prepared in advance for your hands. That is not a mood you woke up in. That is a verdict God settled.

And notice what happens to the question itself: it stops haunting you and starts sending you. "Who am I?" quietly becomes "who am I for?" The most secure people on earth are not the ones endlessly staring into themselves — they are the ones who know who they are and have therefore forgotten themselves enough to go pour their lives out for others. Settled identity always turns outward into assignment.

So today, walk away from the mirror. Not because the question stopped mattering — it mattered enough to fill ten days — but because it has finally been answered by Someone whose answers do not change with your circumstances, your critics, or your moods. You know who you are now. Go and spend it.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What "good works prepared in advance" might already be within reach of your hands this week?

— The next time life asks you who you are, how will your answer be different from ten days ago?$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,     $dev$Lord, thank You for answering the question I have carried my whole life. I am not a stranger in the mirror anymore; I am Yours, and I know it. Now send me. Let my unshakable identity become an unstoppable assignment, and let the world around me be better because I finally know who You made me to be. Amen.

_May you walk away from the mirror today and into the good works God prepared for your hands long before you asked the question._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,     $dev$Ephesians 2:1–10; Jeremiah 1:5$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
