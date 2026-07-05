-- Reseed better-together with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'better-together');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Mark 3:14', 'He Chose Twelve to Be With Him'),
  (2, 'Ecclesiastes 4:9–10, 12', 'The Cord of Three Strands'),
  (3, 'Proverbs 27:17', 'Iron Sharpens Iron'),
  (4, '1 Samuel 23:16', 'A Jonathan in the Wilderness'),
  (5, '1 Kings 12:8', 'The Company That Cost a Kingdom'),
  (6, 'Matthew 18:19', 'The Power of Agreement'),
  (7, 'Job 42:10', 'Pray for Your People'),
  (8, 'Romans 16:3–5', 'Aquila and Priscilla: Partners in Everything'),
  (9, '2 Timothy 2:2', 'Mentors and Sons'),
  (10, '1 Corinthians 12:27', 'Planted in the Body')
) AS v(n, ref, title) WHERE p.code = 'better-together';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'better-together'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', 'Mark 3:14', $dev$“He appointed twelve that they might be with him and that he might send them out to preach.”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,        $dev$Here is a fact that should quietly end all lone-ranger Christianity: the Son of God did not walk alone. Perfect, sinless, filled without measure — and still He gathered a company around Himself before He preached a single sermon on a hillside.

Read the first line of the apostles' job description slowly, because we usually skip past it to the impressive part. He appointed twelve — for what? "That they might be with him," and only then "that he might send them out." Presence before power. Companionship before commission. Before they were preachers or miracle-workers, they were simply men who got to be near Him. And out of the twelve He drew three — Peter, James and John — into His most private rooms: the mountain where His face shone, the house where He raised a dead girl, the garden where He sweat blood. Even the Sinless One kept an inner circle.

This dismantles a lie many of us have quietly organized our lives around — that maturity means needing no one, that strength means self-sufficiency, that the truly spiritual walk with God alone. But we were built in the image of a God who is Himself community — Father, Son and Spirit in unbroken fellowship. "It is not good for the man to be alone" (Genesis 2:18) was spoken in a sinless garden, over a man who already had God. Aloneness was the first thing God ever called "not good."

So look honestly at your own life today. Where has "I can manage on my own" been quietly running the show — and what has that independence actually cost you in joy, in growth, in the weight you carry that was never meant to be carried solo? If Jesus structured His life around chosen companionship, the humility to admit "I was not designed for alone" is not weakness. It is the first wise step toward the company destiny requires.

You were made to be with people, and then sent with them. That order is not an accident. It is the pattern of heaven.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Where has "I can manage alone" been quietly governing your life — and what has it cost you?

— Who currently qualifies as your "with him" people — real presence, not just a name in your contacts?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,        $dev$Lord Jesus, You chose companions before You chose a pulpit — so I lay down the pride of alone. Choose my twelve and my three alongside me, and teach me the first assignment before all the others: simply to be present, and to let others be present to me. Heal what my independence has bruised.

_May the loneliness of managing alone be replaced by the strength of chosen company._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,        $dev$Mark 3:13–19; Luke 6:12–16$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Ecclesiastes 4:9–10, 12', $dev$“Two are better than one, because they have a good return for their labor: if either of them falls down, one can help the other up… A cord of three strands is not quickly broken.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,        $dev$The Preacher of Ecclesiastes has spent chapters staring at everything the sun shines on and calling most of it vapor. Then, almost suddenly, he lands on something that is not vapor — something with a real "return." He finds it in relationship.

Watch how practical he is. Two are better than one, he says, and then he counts the reasons like a merchant tallying profit: a better return on labor, warmth on a cold night, defense when one is attacked, and rescue when one falls down and "there is no one to help them up." He is not being sentimental; he is doing arithmetic. Alone is not merely lonely — alone is expensive. It costs you the shared load, the second set of hands, the voice that says "get up" when you have hit the ground.

Then he lifts the whole thing higher with an image that has outlived him by three thousand years: "A cord of three strands is not quickly broken." Two people are strong; but two people woven together with a third strand — Christ Himself — form the strongest structure on earth. This is not poetry only. Jesus made it literal: "Where two or three gather in my name, there am I with them" (Matthew 18:20). The third strand is not a metaphor. He is a Person, and He shows up in the weaving.

So take the audit today, and be honest at each point. In your labor — the actual work of your life — who shares the load, or are you quietly carrying it all? In your falling — the failures, the low seasons — who has permission to help you up? In your battles — the fears you fight at 2 a.m. — who stands back-to-back with you? Wherever the honest answer is "no one," you have not found a source of shame. You have found a prayer target and a place to begin.

Cords do not appear. Cords are woven, strand by strand, choice by choice. And the weaving can begin this very week — with one invitation, one honest conversation, one decision to stop paying the expensive price of alone.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Run the audit honestly: labor, falling, battle — who is woven in at each point, and where is the "no one"?

— Where will you begin weaving this week — one specific invitation, one commitment you will actually make?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,        $dev$Father, weave my cord. Bring the strands You have chosen for me, make Christ the third in every binding, and let my life stop paying the expensive price of alone. Give me courage for the first invitation. Amen.

_May your life be woven this season into cords that no trouble can quickly break._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,        $dev$Ecclesiastes 4:7–12; Matthew 18:19–20$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Proverbs 27:17', $dev$“As iron sharpens iron, so one person sharpens another.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,        $dev$Pay attention to the metallurgy in this proverb, because it is doing more work than we usually let it. Iron is not sharpened by wool. It is not sharpened by a pillow or a round of applause. It takes iron to sharpen iron — something of the same hardness, close enough and strong enough to strike edge against edge.

That single image quietly exposes the wrong kind of friendship. Comfortable company keeps you comfortable, and comfortable is not the same as sharp. If everyone around you only agrees, only flatters, only softens the truth, you will feel wonderful and grow duller by the year. The friend who questions your excuse, corrects your theology, tells you the truth about the attitude you have been protecting — that friction is not the failure of the friendship. It is the whole function of it. Solomon says it plainly a few verses earlier: "Wounds from a friend can be trusted, but an enemy multiplies kisses" (Proverbs 27:6). Beware a circle that only kisses. You are either their superior or their fool.

But notice the proverb is mutual — iron sharpens iron. This is not a search for a mentor who fixes you while you stay passive. It is a call to find peers of substance, men and women your own size or beyond, walking the same road, licensed to speak into your life — and then to be that for them. Sharpening has sparks. It requires both blades willing to be scraped. You cannot receive the correction you are unwilling to give, and you cannot give what you refuse to receive.

So bring this home to a name. Who is actually licensed to correct you — not in theory, but recently, with something you needed to hear? And whose edge have you watched go dull while you stayed politely, cowardly silent, because saying the hard thing felt like too much? Love is not always soft. Sometimes love is the friend brave enough to make sparks fly for your good.

Mutual sharpening is uncomfortable, and it is the gymnasium of everyone who ever became something. Do not run from the friend who makes you sharper. Thank God for them — and be one.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who is truly licensed to correct you — not in theory, but used recently, on something you needed to hear?

— Whose edge have you watched go dull while you stayed politely silent — and what would love say instead?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,        $dev$Father, bring iron into my life and make me iron in others' lives. Give me friends who spark, the humility to receive the friction, and the love to return it even when silence would be easier. Sharpen me. Amen.

_May every spark in your friendships leave both blades sharper for the battle ahead._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,        $dev$Proverbs 27:5–6, 17; Hebrews 3:13$dev$),
  (4, 1, 'scripture',  'Today''s Reading', '1 Samuel 23:16', $dev$“And Saul’s son Jonathan went to David at Horesh and helped him find strength in God.”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,        $dev$David was hiding in the wilderness of Ziph — a caves-and-thornbushes country, hunted like an animal by a king who wanted him dead. He had been anointed as Israel's next king years earlier, but the anointing had brought nothing yet but exile. Promised a throne, given a cave. That is a peculiar kind of exhaustion: the faith is real, and it is wearing thin.

And into that wilderness walked Jonathan — not a stranger, not a fellow fugitive, but the crown prince himself, the one man with the most earthly reason to see David gone. Jonathan was heir to the very throne David had been promised. By every political calculation he should have hunted David harder than his father did. Instead, Scripture records that he went to David "and helped him find strength in God." He crossed enemy lines, at real risk, for one purpose: to strengthen a discouraged friend's grip on God.

Look closely at what covenant friendship does at its highest, because it is more than we usually settle for. Jonathan did not merely sympathize — "poor David, this is so unfair." He did not merely assist — "here, take some bread and a blanket." He re-anchored David's soul in God, reminding a tired man of what heaven had actually said about him: "You will be king over Israel, and I will be second to you" (1 Samuel 23:17). He held David's own prophecy up in front of David's discouraged eyes and said, in effect, remember what God promised. That is friendship that ministers, not just friendship that comforts.

One friend like that in your wilderness is worth more than a thousand admirers in your palace. So ask the two honest questions this passage forces. Who has walked into a low season of yours and re-anchored you in God rather than just feeling sorry for you — and have you thanked them? And then the harder one: are you that kind of friend? Here is the simple test — after time spent with you, do people find their strength in God increased, or do they mostly leave with their complaints better rehearsed?

Someone near you is in a wilderness right now, faith wearing thin. Be the Jonathan who crosses the distance and helps them find strength in God.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who has walked into your wilderness and re-anchored you in God rather than just pitied you? Thank them today.

— Whose wilderness needs your Jonathan-visit this week — and what would help them find strength in God?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,        $dev$Father, give me Jonathan friendship — to have it, and to be it. Send me to someone's Horesh this week, and let them find their strength in God renewed because I came and pointed them back to Your promise, not just to my sympathy. Amen.

_May every wilderness of your life be interrupted by a covenant friend at exactly the right hour._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,        $dev$1 Samuel 23:14–18; 18:1–4$dev$),
  (5, 1, 'scripture',  'Today''s Reading', '1 Kings 12:8', $dev$“But Rehoboam rejected the advice the elders gave him and consulted the young men who had grown up with him and were serving him.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,        $dev$Rehoboam inherited the largest, richest kingdom his family would ever hold — Solomon's Israel at the height of its glory — and lost ten of its twelve tribes in a single afternoon. What is chilling is how he lost it. Not to an invading army. Not to a plague or a famine. He lost a kingdom to a conversation with the wrong friends.

Here is the scene. The people ask him to lighten Solomon's heavy taxes. Rehoboam wisely consults the elders who had served his father — men who had watched a kingdom rise and knew how it was held together. They counsel patience and kindness. And then Scripture records the fatal pivot: "But Rehoboam rejected the advice the elders gave him and consulted the young men who had grown up with him." He set aside seasoned wisdom and turned to the voices that told his ego what it enjoyed hearing. They advised him to threaten the people, he did, and the kingdom split by nightfall.

The Bible is tender about this danger but completely unbending: "Do not be misled: bad company corrupts good character" (1 Corinthians 15:33). Notice the verb — corrupts, present tense, ongoing. It is not a lightning strike; it is water shaping stone, slow and patient and mostly unnoticed until the damage is done. Your closest voices quietly calibrate your normal. Their ethics become thinkable to you. Their fears become contagious. Their ceilings become the ceiling you inherit without ever deciding to.

This is not a call to despise anyone — Rehoboam's friends were not villains, they were simply the wrong counselors for a throne. It is a call to assign seats wisely. Everyone in your life deserves your love; not everyone has earned your ear. Those are two different gifts, and confusing them has cost more than one person a kingdom. Love is given freely; influence must be given carefully.

So audit the table around you. Whose counsel do you actually consult when a real decision is on the line — elders of wisdom, or echoes of your own ego? And is there a seat at your inner table that needs reassigning — gently, lovingly, but genuinely — before it costs you an afternoon you cannot undo? Love everyone. Seat your inner circle by wisdom.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Whose counsel do you actually consult on real decisions — elders of wisdom, or echoes of your own ego?

— Does any seat at your inner table need reassigning — gently, lovingly, but genuinely — before it costs you?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,        $dev$Father, save me from Rehoboam's afternoon. Give me love for all, ears reserved for the wise, and the courage to reassign the seats my destiny cannot afford. Let me not confuse who I love with who I let counsel me. Amen.

_May your table be seated by wisdom — and your kingdom kept whole because of it._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,        $dev$1 Kings 12:1–19; Proverbs 13:20$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'Matthew 18:19', $dev$“Again, truly I tell you that if two of you on earth agree about anything they ask for, it will be done for you by my Father in heaven.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,        $dev$"Can two walk together, unless they are agreed?" the prophet Amos asked (Amos 3:3), and the question answers itself. You can share an address without sharing a direction. You can stand beside someone and be pulling the opposite way. Company is not the same as agreement — and it is agreement, not mere proximity, to which heaven attaches its most staggering promises.

Look at the mathematics God assigns to unity. In Deuteronomy 32:30 the picture is startling: one man can chase a thousand, but two can put ten thousand to flight. That is not addition — one plus one making two thousand. It is multiplication. The second person does not double the force; he multiplies it tenfold. And Jesus lifts the same principle to its summit in today's verse: "If two of you on earth agree about anything they ask for, it will be done for you by my Father in heaven." Two hearts truly aligned in prayer engage the direct action of God.

If agreement carries that kind of power, you can understand why the enemy's very first strategy against every marriage, every friendship, every church, is division. He cannot out-muscle multiplied power, so he does the only thing he can — he attacks the multiplication itself. Split the two, and the ten thousand stay standing. This is why "a perverse person stirs up conflict, and a gossip separates close friends" (Proverbs 16:28) is not a minor social sin. It is spiritual sabotage aimed at your firepower.

So become a deliberate guardian of agreement. Settle offenses quickly, before they calcify. Keep short accounts with the people closest to you. Refuse to give the whisperer an audience, and refuse to be one. Protect your alliances the way a soldier protects his weapon, because that is what they are.

Then go further and harness it on purpose. Do not let agreement lie dormant. Find one person — a spouse, a friend, a prayer partner — and name a specific request you will bring to the Father together, in genuine alignment, and keep bringing it. Where is disagreement currently draining the multiplication out of your life? And who could become your Matthew 18:19 partner, starting this week? Ten thousand are waiting to flee. They are only waiting for two to agree.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Where is unresolved disagreement currently draining the multiplication out of your life or home?

— Who will be your Matthew 18:19 agreement partner — and over what specific first request will you agree?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,        $dev$Father, make me a guardian of agreement — quick to reconcile, deaf to whisperers, unwilling to let small offenses split what You want to multiply. Join me to a partner of prayer whose amen multiplies mine, and teach us to agree until ten thousand flee. Amen.

_May the mathematics of agreement begin multiplying everything you build._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,        $dev$Matthew 18:15–20; Deuteronomy 32:30$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'Job 42:10', $dev$“After Job had prayed for his friends, the Lord restored his fortunes and gave him twice as much as he had before.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,        $dev$Relationships are sustained less by what everyone sees and more by what you invest in secret — and the deepest secret investment you can make in another person is intercession. Praying for people changes both them and you in ways that talking about them never will.

Nowhere is this quieter or more wonderful than in the last verse of Job's long ordeal. Watch the timing carefully, because the timing is the whole point. Job's fortunes were not restored after he defended himself — he did plenty of that. They were not restored after his friends finally apologized properly for their cruelty. Read it again: "After Job had prayed for his friends, the Lord restored his fortunes." The turning point of the entire book is the moment a wounded man prayed for the people who had wounded him.

And remember who these friends were. For thirty-some chapters they had sat with Job and misdiagnosed his suffering, insisting his agony must be hidden sin, wounding him with confident bad theology when he needed comfort. These were not his supporters. They were, at his lowest, his accusers. Yet God's instruction was not "wait for them to grovel." It was "pray for them" — and praying for them unlocked something in Job that thirty chapters of self-defense never touched, and released a restoration heaven had apparently scheduled to wait behind exactly that obedience.

Samuel pressed this even further. Speaking to a people who had rejected him, he said, "Far be it from me that I should sin against the Lord by failing to pray for you" (1 Samuel 12:23). He counted prayerlessness toward his people as an actual sin. That reframes intercession entirely — not as a nice extra, but as a duty we owe the people in our lives.

So build the roll today. Take a page and write the names: your family, your friends, your leaders — and yes, the difficult ones, the ones who have cost you something, by name. Who has wounded you that God may in fact be inviting you to pray for, Job-style? And what rhythm will actually hold — daily, weekly, a name at a time? Some of the restorations you have been waiting on for yourself are quietly waiting on your knees for somebody else.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who has wounded you that God may be inviting you to pray for, Job-style — and can you begin today?

— Build your intercession roll now: which names go on it, and what rhythm will actually hold?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,        $dev$Father, I take up the priesthood of my relationships. Here are my people — the beloved and the difficult, the faithful and the ones who wounded me — by name before You. Bless them richly; and do in me, as I pray, whatever the praying is meant to unlock. Amen.

_May double restoration find you on your knees for somebody else._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,        $dev$Job 42:7–10; 1 Samuel 12:19–24$dev$),
  (8, 1, 'scripture',  'Today''s Reading', 'Romans 16:3–5', $dev$“Greet Priscilla and Aquila, my co-workers in Christ Jesus. They risked their lives for me… Greet also the church that meets at their house.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,        $dev$There is a married couple who appear six times across the New Testament, and something small but striking is true of every single mention: they are never named apart. Aquila and Priscilla, Priscilla and Aquila — always the pair, always together. In an age that recorded husbands and forgot wives, the Spirit kept insisting on both names. That is a clue worth chasing.

Trace what they did, and the reason becomes obvious. They made tents together, working the same trade side by side. They traveled with Paul together, risking their lives for him. They discipled the brilliant, fiery preacher Apollos together — Scripture says "they invited him to their home and explained to him the way of God more adequately" (Acts 18:26), the two of them tutoring one of the church's greatest voices at their kitchen table. And they hosted a church in their house together. One flesh, and one work.

This is partnership at its full stature, and it is worth naming precisely what makes it that. Aquila and Priscilla were not two people who merely shared an address, a mortgage and a mealtime. They were two people who shared an assignment. Their marriage was a ministry unit. Their tentmaking business quietly funded the mission of the early church. Their home was not just a refuge from the work; it was infrastructure for the kingdom. Heaven noticed, and Paul wrote them a letter of honor by name.

Now bring it home, whatever your situation — married, engaged, still believing for a partner, or single with close co-laborers you serve God beside. "He who finds a wife finds what is good and receives favor from the Lord" (Proverbs 18:22) — and the partnership that prays, works and serves as one becomes something the New Testament greets by name. If you are partnered, the searching question is this: do you share an address, or an assignment? And if you are still believing for that partnership, the question turns inward: what are you becoming, so that one day two of you can genuinely serve as one?

Choose partners in prayer, not merely in appetite. And build the kind of togetherness heaven bothers to write letters to.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,        $dev$— If partnered: do you share an address or an assignment? What one thing would deepen it from the former to the latter?

— If believing for partnership: what are you becoming right now, so that two can one day genuinely serve as one?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,        $dev$Father, build my partnerships to Aquila-and-Priscilla stature — one heart, one work, a home that heaven uses as infrastructure for Your kingdom. Let those closest to me be co-workers in Christ, and make me the kind of partner worth being joined to. Amen.

_May your closest partnership become infrastructure for the Kingdom of God._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,        $dev$Acts 18:1–3, 18–26; Romans 16:3–5$dev$),
  (9, 1, 'scripture',  'Today''s Reading', '2 Timothy 2:2', $dev$“And the things you have heard me say in the presence of many witnesses entrust to reliable people who will also be qualified to teach others.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,        $dev$Destiny travels on a two-way road. There is always someone ahead of you, further along than you, whose example and correction you need; and there is always someone behind you, coming up the same path, who needs yours. The people who go furthest are the ones who keep looking in both directions at once.

Scripture is full of these two-way roads. Elisha poured water on Elijah's hands — did the servant's chores, carried the older prophet's things, stayed faithful in the unglamorous role — and inherited a double portion of his spirit. Timothy served Paul "as a son with his father" (Philippians 2:22) and inherited the care of churches. Notice the pattern that keeps repeating: the men who eventually received the mantle were first the men who carried someone else's luggage without bitterness. Promotion in the kingdom runs through faithful service under someone.

Now read today's verse and count the generations hidden inside one sentence. Paul writes to Timothy: the things you have heard from me (that is generation one, Paul), entrust to reliable people (generation two, Timothy's students), who will be qualified to teach others (generation three, and beyond). Four spiritual generations named in a single line. This is heaven's succession plan — the gospel handed down hand to hand — and it requires you to stand in two positions at the same time: receiving as a son, and transmitting as a father.

This is where many of us go wrong. The person who only ever networks upward — chasing mentors, absorbing, taking, climbing — is building a ladder for himself. The person who invests in both directions, receiving from those ahead and pouring into those behind, is building a legacy that outlives him. One ends when you do. The other keeps going for generations.

So find your Elijah, and actually serve him — do not just consume his content from a distance. And find your Elisha, the one coming up behind you, and actually pour into them — do not just perform for an audience. Which position is currently vacant in your life — mentor, or son? Whichever it is, go fill it this season. Your becoming was never meant to die with you.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who is ahead of you that you genuinely serve — and who behind you that you are actively lifting?

— Which position is currently vacant in your life — mentor or son — and how will you fill it this season?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,        $dev$Father, set me firmly in the succession: a faithful son to my Elijah, and a generous father to my Elisha. Save me from only climbing. Let what You have given me pass through my hands and reach the fourth generation and beyond. Amen.

_May your becoming outlive you by four generations at least._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,        $dev$2 Kings 2:1–15; 2 Timothy 2:1–2$dev$),
  (10, 1, 'scripture',  'Today''s Reading', '1 Corinthians 12:27', $dev$“Now you are the body of Christ, and each one of you is a part of it.”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,        $dev$For nine days we have gathered the relationships destiny requires — iron peers who sharpen you, Jonathans who strengthen you, mentors and sons who pass the mantle, partners who share the assignment. But all of them grow in one appointed greenhouse, and today names it: the body of Christ, gathered and local. Not the church as an abstract idea. The church as a place you belong, with people who know your name.

"Those planted in the house of the Lord will flourish in the courts of our God" (Psalm 92:13). Underline the word planted — because it is not a decorative verb. It is the opposite of visiting, of sampling, of streaming the service from a comfortable distance and calling that fellowship. Planted means rooted. It means committed. It means you have put your life somewhere and let it grow down into that soil, through seasons dry and green, instead of staying loose enough to leave the moment you are disappointed.

The local body is where the relationships this whole plan describes actually become possible. It is where your gifts finally find their function — "each one of you is a part of it," Paul says, and a part with no body has no purpose. It is where your rough edges meet the sharpening of real people you cannot curate or unfollow. It is where you are known well enough to be genuinely helped, and needed enough to actually grow. You cannot be a Jonathan or receive an Elisha from a distance. Covenant requires proximity.

Think of a single coal. In the fire, surrounded by other coals, it glows white-hot. Pull it out and set it alone on the cold hearth, and within minutes it dims and dies — not because anything is wrong with the coal, but because a coal was never designed to burn alone. It is not weakness to need the fire. It is design. The believer who drifts from fellowship does not usually fall dramatically; he simply, quietly cools.

So end this plan with the strongest commitment of all, and make it specific. Plant yourself. Join. Serve where there is a need. Submit to leadership. Stay through the dry seasons instead of shopping for a warmer fire. Are you honestly planted, potted, or drifting? The stronger your relationships, the stronger your leadership will be — and the deepest, most destiny-shaping relationships of your life are waiting for you inside the commitment you are willing to keep to God's family. Get in the fire, and never again alone.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Are you honestly planted, potted, or drifting in a local body right now — and why?

— What would full planting look like for you: membership where, serving in what, accountable to whom?$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,        $dev$Father, plant me in Your house and let me stay. Give me roots that hold through every season, brothers and sisters who become the cord that carries me, and fruit that proves the planting was real. Keep me in the fire, and never again alone. Amen.

_May you flourish, deeply planted, in the courts of our God — never alone again._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,        $dev$1 Corinthians 12:12–27; Psalm 92:12–15$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
