-- Better Together: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional',       NULL,        $dev$Begin with a fact that should end all lone-ranger Christianity: the Son of God did not walk alone. He chose twelve — and read their first job description carefully: that they might be with him. Before preaching, before power — presence. Companionship was the first assignment.

And out of the twelve He drew three — Peter, James, John — into His most private rooms: the mountain of transfiguration, the house of Jairus, the garden of Gethsemane. Even perfection kept an inner circle.

If the Sinless One structured His life around chosen companionship, who are you and I to attempt destiny without it? This plan begins with the humility of that admission: I was not designed for alone. Then it turns to the joyful work: choosing, keeping and becoming the company destiny requires.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Where has "I can manage alone" been governing your life — and what has it cost?

— Who currently qualifies as your "with him" people — presence, not just contact?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,        $dev$Lord Jesus, You chose companions — so I lay down the pride of alone. Choose my twelve and my three with me, and teach me the first assignment: presence. Amen.

_May the loneliness of managing alone be replaced by the strength of chosen company._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,        $dev$Mark 3:13–19; Luke 6:12–16$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Ecclesiastes 4:9–10, 12', $dev$“Two are better than one, because they have a good return for their labor: if either of them falls down, one can help the other up… A cord of three strands is not quickly broken.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,        $dev$The Preacher gives partnership its economics: two are better than one because the return is better — in labor, in warmth, in defense, in rescue when one falls. Alone is not just lonely; alone is expensive.

Then comes the upgrade: a cord of three strands is not quickly broken. Two believers woven with Christ Himself as the third strand form the strongest structure on earth — “where two or three gather in my name, there am I with them” (Matthew 18:20).

Take the audit today: in your labor, who shares the load? In your falling, who lifts you? In your battles, who stands back-to-back with you? Where the answer is “no one,” you have found not a shame but a prayer target. Cords are woven — and weaving can begin this week.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Run the audit: labor, falling, battle — who is woven in at each point?

— Where will you begin weaving this week — one invitation, one commitment?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,        $dev$Father, weave my cord. Bring the strands You have chosen, make Christ the third in every binding, and let my life stop paying the expensive price of alone. Amen.

_May your life be woven this season into cords no trouble can quickly break._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,        $dev$Ecclesiastes 4:7–12; Matthew 18:19–20$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Proverbs 27:17', $dev$“As iron sharpens iron, so one person sharpens another.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,        $dev$Notice the metallurgy: iron is not sharpened by wool or by wood — it takes iron to sharpen iron. Comfortable company keeps you comfortable; only peers of substance, close enough to strike edges with you, make you sharper.

Sharpening has sparks. The friend who questions your excuse, corrects your doctrine, tells you the truth about your attitude — that friction is not the failure of friendship but the function of it. “Wounds from a friend can be trusted, but an enemy multiplies kisses” (Proverbs 27:6). Beware a circle that only applauds you; you are either their superior or their fool.

So seek iron: men and women your own size or beyond, walking the same road, licensed to speak into you. And be iron — loving enough to spark when a friend's edge dulls. Mutual sharpening is the gymnasium of becoming.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who is licensed to correct you — truly licensed, and used recently?

— Whose edge have you watched dull while you stayed politely silent?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,        $dev$Father, bring iron into my life and make me iron in others'. Give me friends who spark, the humility to receive it, and the love to return it. Amen.

_May every spark in your friendships leave both blades sharper for battle._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,        $dev$Proverbs 27:5–6, 17; Hebrews 3:13$dev$),
  (4, 1, 'scripture',  'Today''s Reading', '1 Samuel 23:16', $dev$“And Saul’s son Jonathan went to David at Horesh and helped him find strength in God.”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,        $dev$David was a fugitive in the wilderness of Ziph — anointed years ago, hunted daily, faith wearing thin. And into that wilderness walked Jonathan, the king's own son, for one recorded purpose: he helped him find strength in God.

Mark what covenant friendship does at its highest: it does not merely sympathize (“poor David”), nor merely assist (“here is bread”). It re-anchors the soul in God — reminding a tired man of what heaven said about him: “You will be king over Israel.” Jonathan strengthened David's grip on his own prophecy.

One such friend in your wilderness is worth more than a thousand admirers in your palace. Do you have one? Are you one? The measure is simple: after time with you, do people find their strength in God increased — or only their complaints better rehearsed?$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who has walked into your wilderness and re-anchored you in God? Thank them today.

— Whose wilderness needs your Jonathan-visit this week?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,        $dev$Father, give me Jonathan friendship — to have, and to be. Send me to someone's Horesh this week, and let them find strength in God because I came. Amen.

_May every wilderness of your life be interrupted by a covenant friend at the right hour._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,        $dev$1 Samuel 23:14–18; 18:1–4$dev$),
  (5, 1, 'scripture',  'Today''s Reading', '1 Kings 12:8', $dev$“But Rehoboam rejected the advice the elders gave him and consulted the young men who had grown up with him and were serving him.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,        $dev$Rehoboam inherited the largest kingdom his family would ever hold — and lost ten of twelve tribes in a single afternoon. The instrument of the loss was not an army. It was a circle: he dismissed seasoned counsel and listened to “the young men who had grown up with him,” who told him what his ego enjoyed hearing.

Scripture is tender but unbending: “Do not be misled: bad company corrupts good character” (1 Corinthians 15:33) — present tense, patient, like water shaping stone. Your closest voices calibrate your normal: their ethics become thinkable to you, their fears contagious, their ceilings inherited.

This is not a call to despise anyone; it is a call to assign seats wisely. Everyone deserves your love; not everyone earns your ear. Ask of your inner circle: are these voices building the person my book requires — or applauding the person my flesh prefers?$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Whose counsel do you actually consult — elders of wisdom, or echoes of your ego?

— Does any seat at your inner table need reassigning — gently, lovingly, firmly?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,        $dev$Father, save me from Rehoboam's afternoon. Give me love for all, ears for the wise, and courage to reassign the seats my destiny cannot afford. Amen.

_May your table be seated by wisdom — and your kingdom kept whole because of it._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,        $dev$1 Kings 12:1–19; Proverbs 13:20$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'Matthew 18:19', $dev$“Again, truly I tell you that if two of you on earth agree about anything they ask for, it will be done for you by my Father in heaven.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,        $dev$“Can two walk together, except they be agreed?” (Amos 3:3). Agreement is more than company — it is alignment, and heaven attaches staggering mathematics to it: one can chase a thousand, but two can put ten thousand to flight (Deuteronomy 32:30). Not addition — multiplication.

Jesus raises it higher still: two on earth, agreeing in prayer, engage the Father's action. Agreement is a spiritual technology — which is exactly why the enemy's first strategy against every partnership, marriage and church is division. He cannot match multiplied power, so he attacks the multiplication itself.

So become a guardian of agreement: settle offenses quickly, keep short accounts, refuse the whisperer who separates close friends (Proverbs 16:28). And harness it deliberately — find your prayer-agreement partner and name your battles together. Ten thousand are waiting to flee.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Where is disagreement currently draining multiplication from your life?

— Who will be your Matthew 18:19 agreement partner — and over what first request?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,        $dev$Father, make me a guardian of agreement — quick to reconcile, deaf to whisperers. And join me to a partner of prayer whose amen multiplies mine. Amen.

_May the mathematics of agreement begin multiplying everything you build._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,        $dev$Matthew 18:15–20; Deuteronomy 32:30$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'Job 42:10', $dev$“After Job had prayed for his friends, the Lord restored his fortunes and gave him twice as much as he had before.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,        $dev$Relationships are sustained by what you invest in secret — and the deepest investment is intercession. Watch the timing in Job's story, for it is one of Scripture's quietest wonders: not after Job defended himself, not after his friends apologized properly — after Job prayed for his friends, the Lord restored his fortunes double.

And these were the friends who had wounded him with bad theology for thirty chapters! Praying for them healed something praying about himself never touched — and unlocked a restoration heaven had apparently scheduled behind that very obedience.

Samuel went further: “far be it from me that I should sin against the Lord by failing to pray for you” (1 Samuel 12:23) — prayerlessness for his people he counted as sin. So build the roll: family, friends, leaders, the difficult ones by name. Some of your own restorations are waiting on your intercession for others.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who has wounded you that God may be inviting you to pray for — Job-style?

— Build your intercession roll today: which names, what rhythm?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,        $dev$Father, I take up the priesthood of my relationships. Here are my people — the beloved and the difficult — by name. Bless them richly; and do in me whatever the praying unlocks. Amen.

_May double restoration find you on your knees for somebody else._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,        $dev$Job 42:7–10; 1 Samuel 12:19–24$dev$),
  (8, 1, 'scripture',  'Today''s Reading', 'Romans 16:3–5', $dev$“Greet Priscilla and Aquila, my co-workers in Christ Jesus. They risked their lives for me… Greet also the church that meets at their house.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,        $dev$Every mention of this couple in Scripture — and there are six — names them together. They made tents together, traveled with Paul together, discipled the mighty Apollos together (“they invited him to their home and explained the way of God more adequately”), and hosted a church in their house together. One flesh, one work.

Here is partnership at full stature: not two people merely sharing an address, but two people sharing an assignment. Their marriage was a ministry unit; their business funded mission; their home was infrastructure for the kingdom.

Whatever your state — married, engaged, hoping, or single with close co-laborers — study them: “He who finds a wife finds what is good and receives favor from the Lord” (Proverbs 18:22), and the partnership that prays, works and serves as one becomes something the New Testament greets by name. Choose partners in prayer, not in appetite; and build the kind of togetherness heaven writes letters to.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,        $dev$— If partnered: do you share an address or an assignment? What would deepen it?

— If believing for partnership: what are you becoming, so that two can serve as one?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,        $dev$Father, build my partnerships to Aquila-and-Priscilla stature — one heart, one work, a home that heaven uses. Let those closest to me be co-workers in Christ. Amen.

_May your closest partnership become infrastructure for the Kingdom of God._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,        $dev$Acts 18:1–3, 18–26; Romans 16:3–5$dev$),
  (9, 1, 'scripture',  'Today''s Reading', '2 Timothy 2:2', $dev$“And the things you have heard me say in the presence of many witnesses entrust to reliable people who will also be qualified to teach others.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,        $dev$Destiny travels on a two-way road: someone ahead of you, someone behind you. Elisha poured water on Elijah's hands — and inherited a double portion. Timothy served Paul “as a son with his father” — and inherited churches. The men who received mantles were first men who carried someone's luggage without bitterness.

Read today's verse and count the generations: what I said, you entrust to reliable people who teach others — four spiritual generations in one sentence. That is heaven's succession plan, and it needs you in two positions at once: receiving as a son, transmitting as a father.

The man who only networks upward builds a ladder; the man who invests in both directions builds a legacy. So find your Elijah — and serve, not just consume. And find your Elisha — and pour, not just perform. Becoming was never meant to die with you.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Who is ahead of you that you serve — and who behind you that you lift?

— Which position is vacant — mentor or son — and how will you fill it this season?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,        $dev$Father, set me in the succession: a faithful son to my Elijah, a generous father to my Elisha. Let what You gave me reach the fourth generation. Amen.

_May your becoming outlive you by four generations at least._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,        $dev$2 Kings 2:1–15; 2 Timothy 2:1–2$dev$),
  (10, 1, 'scripture',  'Today''s Reading', '1 Corinthians 12:27', $dev$“Now you are the body of Christ, and each one of you is a part of it.”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,        $dev$All these relationships — iron peers, Jonathans, mentors, partners — grow in one appointed greenhouse: the body of Christ, gathered and local. “Those planted in the house of the Lord will flourish in the courts of our God” (Psalm 92:13). Planted — not visiting, not sampling, not streaming from a distance. Rooted.

The body is where your gifts find their function (“each one of you is a part of it”), where your rough edges meet their sharpening, where you are known well enough to be helped and needed enough to grow. A coal in the fire glows; a coal on the hearth cools — it is not weakness to need the fire; it is design.

So end this plan with the strongest commitment of all: plant yourself. Join, serve, submit, stay — through seasons dry and green. The stronger your relationships, the stronger your leadership; and the deepest relationships of your life are waiting inside the commitment you keep to God's family.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Are you planted, potted, or drifting — honestly?

— What would full planting look like: membership, serving where, accountable to whom?$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,        $dev$Father, plant me in Your house. Give me roots that hold through every season, brothers and sisters who become my cord, and fruit that proves the planting. Amen.

_May you flourish, deeply planted, in the courts of our God — never alone again._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,        $dev$1 Corinthians 12:12–27; Psalm 92:12–15$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
