-- Reseed readers-become-leaders with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'readers-become-leaders');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'John 1:1, 14', 'The Word Became Flesh'),
  (2, 'Hebrews 4:12', 'Reading Is Farming the Mind'),
  (3, '2 Timothy 2:15', 'Squeeze the Orange'),
  (4, 'Psalm 1:1–3', 'It Will Show Tomorrow'),
  (5, '2 Timothy 4:13', 'Bring My Books and the Parchments'),
  (6, 'Daniel 9:2', 'Daniel Read — and Heaven Moved'),
  (7, 'Deuteronomy 17:18–19', 'The King Must Copy the Book'),
  (8, 'Proverbs 9:9', 'The World in Your Room'),
  (9, 'Philippians 4:8', 'Read Everything Through the Book'),
  (10, 'Deuteronomy 6:6–7', 'Raise Readers, Leave Libraries')
) AS v(n, ref, title) WHERE p.code = 'readers-become-leaders';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'readers-become-leaders'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'John 1:1, 14', $dev$“In the beginning was the Word, and the Word was with God, and the Word was God… The Word became flesh and made his dwelling among us.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Of all the names heaven could have given the Son when He stepped into our world, it chose one that a reader would love: the Word. Not the Force, not the Power, not the Flame — the Word. Stop and let that settle. The God you are learning to follow introduces His own Son the way an author signs a manuscript.

This is no accident of translation. John opens his Gospel by deliberately echoing Genesis — “In the beginning” — and shows us a God who has always been speaking. He created by speaking light into darkness. He revealed Himself by giving a written covenant to a nation of former slaves. And when the fullness of time came, He did not send a feeling or a philosophy; He sent the Word made flesh to dwell among us, close enough to touch.

Watch how Jesus Himself treated Scripture, and you will see the reader-heart of God. Again and again He asked religious experts a piercing question — “Have you not read…?” — as though the answer to their crises had been sitting on the page all along. He answered the devil in the wilderness with three quotations from Deuteronomy. He walked into the synagogue at Nazareth, unrolled the scroll of Isaiah, and read His own commissioning aloud (Luke 4:16–21). Even after the resurrection, He warmed two heartbroken travellers by opening “Moses and all the Prophets” to them. The Master was a reader before He was anything the world would call successful.

So this plan is not self-improvement dressed in spiritual language; it is discipleship. We do not read to impress or to accumulate — we read because our God writes, and every book we will ever open is finally measured against the Book that reads us. Today, come to that Book not as a critic but as a child before its Author.

You are following a God who speaks. Learn to love the page, and you will hear Him more clearly than ever before.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What is your current relationship with reading — a feast, a famine, or the occasional snack — and what has made it that way?

— What would it mean this month to follow a Master who kept asking, “Have you not read?”$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Living Word, make me a lover of the written word — beginning with Yours. Open my eyes to see wonderful things in Your law, and give me a reader''s hungry, humble heart. Where I have treated Scripture as duty, restore it to me as a place of meeting. Amen.

_May the Word who became flesh make every page you read a place where you meet Him._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$John 1:1–18; Luke 4:16–21$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Hebrews 4:12', $dev$“For the word of God is alive and active. Sharper than any double-edged sword…”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Every farmer knows a stubborn law: you do not harvest what you wish for — you harvest what you plant. Wheat gives wheat; weeds give weeds; and the ground never argues about it. What most people never realise is that the same law governs the mind. Whatever you feed it, you are farming it.

That is what makes reading such a quietly powerful act. It is deliberate agriculture. You choose the seed — this author, this idea, this book. You choose the field — the corner of your mind you are cultivating. You choose the season — the fifteen minutes you give before the world wakes up. No other input in your whole life hands you this much control over your own formation. Television chooses for you. The feed chooses for you. A book waits for you to choose.

And the harvests differ wildly. A mind fed on gossip grows suspicion. A mind fed only on screens grows restless and shallow, unable to sit still with a single thought. But a mind fed on great books grows large rooms — rooms of history, empathy, wisdom and vision that no circumstance can demolish. And a mind fed on the living Word grows something sharper still. The writer of Hebrews says God''s word is “alive and active, sharper than any double-edged sword,” able to divide even soul from spirit — a discernment no secular book can plant. Proverbs promises that the one who takes in wisdom''s words will “understand the fear of the Lord and find the knowledge of God” (Proverbs 2:5).

Here is the freeing truth: poverty may surround your body, but it needs your permission to enter your mind — and reading is how the siege is broken. So take responsibility for the field today. Whatever is currently going in is currently planting something.

Choose your seed on purpose. In a year you will not have wished a harvest — you will have grown one.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— When you look honestly at what you have been feeding your mind this year, what has it been farming in you?

— What one deliberate “seed” — a book, a subject, a discipline — will you plant in the field next?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I take up the farmer''s responsibility for my own mind. Forgive me for the careless seed I have let fall into good ground. Choose the seed with me now, and let this season''s reading grow rooms in me that Your blessing can one day fill. Amen.

_May your mind become farmland so well-planted that every season of your life yields wisdom._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 4:12–13; Proverbs 2:1–6$dev$),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 2:15', $dev$“Do your best to present yourself to God as one approved, a worker who does not need to be ashamed and who correctly handles the word of truth.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Two people can read the same book and walk away as different as a full man from a hungry one. The difference is almost never the book. It is the squeezing.

Paul tells Timothy to “correctly handle the word of truth” — literally, to cut it straight, to work it like a craftsman who refuses to be ashamed of a sloppy job. Reading like that is not passive. It is read, then think; read, then ponder; read, then meditate — squeezing the virtue out of a page the way you squeeze juice from an orange. And here is the sentence to underline in your own mind: pages turned are not the same as nutrition gained. You can finish a book and be no fuller than when you began, the way you can sit at a feast and leave hungry because you only looked at the food.

The squeezer''s tools are humble and available to everyone. A pen — to mark the line that strikes you, because an unmarked book is a conversation you refused to answer. A question — “what does this actually mean, and what am I to do with it?” A pause — the discipline to stop at the sentence that burns and simply stay there instead of rushing on. And a notebook — because what you write down you begin to own, while what you merely admire evaporates by evening. This is exactly the meditation the psalmist describes when he says God''s word was his delight, pondered all day long until it made him “wiser than my enemies” (Psalm 119:98).

So slow down this week. One book squeezed will change you more than twenty books skimmed. You are not in a race against other readers to see who finishes first.

You are at a table, and the meal in front of you deserves to be chewed.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Be honest: are you mostly a page-turner or a juice-squeezer — and what would slowing down cost you?

— Take today''s reading. What one sentence deserves a full stop, a pen mark, and a line in your notebook?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, deliver me from decorative reading that fills my shelves but not my soul. Teach me to squeeze — to think, ponder and meditate until the virtue of the page enters the bloodstream of my everyday life. Make me a worker who need not be ashamed. Amen.

_May every orange you squeeze this week fill your cup until it runs over._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 2:15; Psalm 119:97–104$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 1:1–3', $dev$“Blessed is the one… whose delight is in the law of the Lord, and who meditates on his law day and night. That person is like a tree planted by streams of water, which yields its fruit in season.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$There is a quiet law that governs every reader, and it cuts both ways. If you read today, it will show tomorrow. And if you do not read today — that will also show tomorrow. Either way, tomorrow tells the truth about today.

The reason we so easily neglect reading is that its returns are invisible in the short term. Fifteen pages tonight will not change your life by morning; skipping them will not ruin you by morning either. But reading works like compounding interest: unnoticeable day by day, undeniable over years. The vocabulary that will one day carry your ideas, the judgment that will navigate your hardest decisions, the deep reservoir your best conversations draw from, the strange calm of a mind that has watched — through a hundred books — how many storms finally end: all of it accrues page by page, or quietly fails to.

Look closely at the picture the psalmist paints. The blessed man is “like a tree planted by streams of water.” Notice — the tree does not strain to produce fruit. It fruits because of where it is planted and what it drinks, day after ordinary day. It is not trying; it is rooted. That is the secret hidden in the word “meditates… day and night” — not a heroic burst, but a steady, daily drinking that becomes character over seasons.

So stop waiting for inspiration and simply plant yourself. Choose a fixed time. Choose a fixed place. Put pages before pixels, at least for the first quiet minutes of the day. Fifteen pages a day is more than five thousand pages a year — an entire shelf of transformation hidden inside your ordinary mornings, waiting to show.

Do not despise the small daily deposit. Tomorrow is watching what you do tonight.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— What has already “shown” in your life — for better or worse — from your reading, or from the lack of it?

— Fix it now, concretely: what time, what place, and how many pages a day will you commit to?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, plant me by the streams. I bring You my small, fixed, faithful daily pages — nothing heroic, just steady — and I trust You for the season of fruit that will surely show in time. Root me deeper than my moods. Amen.

_May your quiet daily pages compound, in time, into a visibly blessed life._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 1; Joshua 1:8$dev$),
  (5, 1, 'scripture', 'Today''s Reading', '2 Timothy 4:13', $dev$“When you come, bring the cloak that I left with Carpus at Troas, and my scrolls, especially the parchments.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Picture the scene, because it is one of the most moving in all of Scripture. An old man sits in a cold Roman cell on death row. He has planted churches across the empire, been caught up to the third heaven, and written a large portion of the New Testament. Now, near the end, he writes a final letter — and in it he makes a small, human request: bring my coat, and bring my books, and especially the parchments.

Facing winter and execution, Paul wanted two things: warmth, and something to read. Let that quietly correct us. If revelation of Paul''s magnitude did not retire him from study, then no anointing you carry retires you either. If a man that close to glory still hungered for the parchments, then no season of life — however senior, however accomplished — ever outgrows the page. The learners keep leading precisely because the leaders never stop learning.

We tend to imagine an arrival point: a level of experience, a title, an age, after which the mind may finally close and coast. Paul destroys that fantasy. There is no such point this side of heaven. The moment we decide we have read enough is the moment we begin, imperceptibly, to shrink. Solomon saw it too: “The heart of the discerning acquires knowledge, for the ears of the wise seek it out” (Proverbs 18:15). Notice the verbs — acquires, seeks out. Wisdom is never passive; it is always still reaching for the next parchment.

Whatever your age, your qualifications, or your years of experience, somewhere there is a coat, a scroll, and a parchment with your name on it — the reading your next season quietly requires.

Do not settle in. Send for them.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you quietly “retired” from learning without admitting it — and if so, when did it happen?

— What are your “parchments” right now — the specific reading your next season is asking of you?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, give me Paul''s dying appetite — still learning, still reaching, still asking for the parchments even at the end. Keep my mind open and my desk stocked, and guard me from the pride that thinks it has learned enough. Amen.

_May you be found, at every age, with fresh parchments open on your desk._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 4:9–13; Proverbs 18:15$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Daniel 9:2', $dev$“In the first year of his reign, I, Daniel, understood from the Scriptures, according to the word of the Lord given to Jeremiah the prophet, that the desolation of Jerusalem would last seventy years.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$One of the mightiest prayer movements in the whole Bible did not begin with an angel, a vision, or a voice from heaven. It began with a man reading an old scroll by lamplight.

Daniel was an exile — a high official in a foreign empire, decades into captivity, easily excused if he had stopped expecting anything from God. But he was still studying the prophets. And as he read Jeremiah''s scroll, something ignited: he “understood from the Scriptures” that the seventy years of Jerusalem''s desolation were almost complete. He did the arithmetic of the promise, and realised the appointed hour of restoration had nearly arrived. God''s word to Jeremiah had promised exactly this — “When seventy years are completed for Babylon, I will come to you and fulfil my good promise” (Jeremiah 29:10).

Now watch what that reading produced, because it is a whole theology of the page in three steps. First, the scroll produced understanding — Daniel saw the season he was living in. Second, that understanding produced intercession — he turned to the Lord in fasting, sackcloth and one of the most passionate prayers in Scripture. Third, his intercession produced visitation — while he was still praying, the angel Gabriel arrived with revelation that stretches to the end of the age. Reading, then prayer, then heaven moving. Daniel did not stumble into his moment. He read his way into it.

Here is the sobering, thrilling implication for you. There are timings, promises and assignments waiting in texts you have not yet opened — in the Word first of all, and in the accumulated wisdom of the ages besides. Some of the breakthroughs you have been begging God for are not being withheld from you at all.

They are simply, still, unread.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What might currently be “unread” in your life — a promise, a season, a wisdom waiting in a text you have not opened?

— What understanding, if you actually gained it, would change the way you pray?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$God of Daniel, let my reading produce understanding, my understanding produce prayer, and my prayer produce Your visitation. Open my eyes to the scroll written for my season, and give me the discipline to read my way into my moment. Amen.

_May something you read this month send you to your knees — and heaven to your door._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 9:1–23; Jeremiah 29:10–14$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Deuteronomy 17:18–19', $dev$“When he takes the throne of his kingdom, he is to write for himself on a scroll a copy of this law… It is to be with him, and he is to read it all the days of his life.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Long before Israel ever crowned a single king, God wrote the job description — and the very first duty listed was not military, financial or diplomatic. It was reading.

The command is startling in its detail. When a man takes the throne, he must personally hand-copy the entire Book of the Law onto his own scroll, keep it beside him, and “read it all the days of his life.” Why such a burden on the busiest man in the nation? The text tells us plainly: “so that he may learn to revere the Lord his God… and not consider himself better than his fellow Israelites.” Heaven''s logic here is worth memorising: authority without daily reading curdles into arrogance, and power without the page always begins to drift. Leaders who stop reading start assuming — and the people beneath them pay for their leaders'' assumptions.

Notice that this law scales with responsibility. The bigger the trust on your life — a home, a business, a ministry, a team, an office — the more binding the king''s law becomes on you. Growing influence is not a reason to read less; it is the very reason to read more, because more people now live downstream of your blind spots.

And do not miss the method: “write for himself.” Not have a scribe do it — do it yourself, slowly, personally, by hand. There is a reason. What passes through your own hand governs you more deeply than what merely passes before your eyes. Copying out the texts that must rule you plants them at a depth that skim-reading never reaches. This is how kings stayed teachable, and how a young Solomon was charged by his dying father to “walk in obedience… as written in the Law of Moses” (1 Kings 2:3).

Readers become leaders — and, just as importantly, they remain safe ones.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— As your responsibilities have grown over the years, has your reading grown alongside them — or quietly thinned out?

— What governing text will you hand-copy this week, king-style — slowly, personally, by your own hand?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, bind the king''s law on me: the Book beside me, read all my days, copied out by my own hand — so that whatever authority You give me never outgrows my reverence for You. Keep me teachable in every increase. Amen.

_May every increase of your authority be matched by an increase of your reading._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Deuteronomy 17:14–20; 1 Kings 2:1–4$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Proverbs 9:9', $dev$“Instruct the wise and they will be wiser still; teach the righteous and they will add to their learning.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is the quiet miracle of a book: for the price of a single volume, you can bring the whole world into your room. You cannot travel to every teacher you need, and most of them would never fit into your schedule — but they will sit patiently on your shelf, available at midnight, waiting for you to open them.

Think of the company reading makes possible. Solomon will tutor you in wisdom. Paul will disciple you in grace. The great men and women of every century — in leadership, in finance, in prayer, in the craft of your calling — will pour decades of their hard-won learning into you across a few evenings. Proverbs promises exactly this compounding return: “Instruct the wise and they will be wiser still.” The wise are not those who already know enough; they are those who keep adding, because they have learned to sit humbly at the feet of better minds.

And this is God''s special mercy to the one from humble beginnings. Libraries do not check family names. The boy who missed school terms can still out-learn his whole generation, because a book asks nothing about your background before it teaches you. Many of the walls that poverty builds around a life, reading quietly dismantles, brick by patient brick. “Walk with the wise and become wise,” Solomon says (Proverbs 13:20) — and the wise are always within reach of anyone willing to read.

So build your council of paper mentors on purpose, not by accident. Gather the biographies of the greatly used. Collect the classics of prayer and faith. Own the craft books of your particular calling. Choose mentors whose fruit you would actually want to bear, because whoever disciples your mind will, in the end, direct your feet.

Your small room can host the wisest company in the world. Send the invitations.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Who currently sits on your “council of paper mentors” — and, just as tellingly, who is missing from it?

— Which biography or classic will you deliberately appoint to that council this month?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, assemble my council. Bring into my room, through books, the very mentors my becoming requires — and give me the humility to sit at their feet and learn instead of pretending I already know. Amen.

_May your small room host the wisest company in the world._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 9:9–12; 13:20$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Philippians 4:8', $dev$“Finally, brothers and sisters, whatever is true, whatever is noble… think about such things.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$A serious reader eventually needs one more instrument — not another book, but a filter. Because not every page deserves your bloodstream. Some books carry sweet-tasting error, and a reader without discernment can farm weeds with tremendous diligence, watering lies as carefully as truth.

Paul gives us the standard: “whatever is true, whatever is noble… think about such things,” and elsewhere, “test them all; hold on to what is good” (1 Thessalonians 5:21). The filter is not your taste, your tradition, or the reputation of the author. The filter is the Book itself. Scripture is the standard weight on the scale against which every other idea must be measured. This means you can — and should — read widely, but you must always weigh biblically. Read the philosopher, the strategist, the poet, the entrepreneur; but when any author''s counsel contradicts the Word of God, the author loses. However famous the name, however beautiful the prose, the verdict is already settled.

This is precisely what earned the Bereans their honour. Luke calls them “of more noble character” for a very specific reason: they received Paul''s teaching with great eagerness and then “examined the Scriptures every day to see if what Paul said was true” (Acts 17:11). Notice the balance — eager to learn, yet unwilling to swallow anything unweighed. Not cynical, not gullible. Discerning.

So keep the Word central in your reading life. Let it be the first book you open in the day and the lens through which you read all the others. A believer who reads everything through the Book is not narrow — he is anchored. And an anchored mind can venture into deep and dangerous waters that would sweep an unanchored one away.

Readers who learn to weigh become leaders who cannot be easily deceived.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you currently read with a filter, or does everything you read get equal, unweighed access to your thinking?

— Where has a persuasive book or voice quietly out-voted Scripture in the way you actually think and live?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, make Your Word the scale on my desk. I will read widely and weigh everything — holding fast to what is good, releasing what is not, and deceived by none. Give me a Berean heart: eager to learn, unwilling to be misled. Amen.

_May you grow into a reader whom error finds difficult and truth finds hospitable._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:10–12; 1 Thessalonians 5:19–22$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Deuteronomy 6:6–7', $dev$“These commandments that I give you today are to be on your hearts. Impress them on your children. Talk about them when you sit at home and when you walk along the road…”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Your reading life was never meant to end with you. A river that only fills a private pool eventually stagnates; a river that keeps flowing feeds fields it will never see. The final movement of a reader''s becoming is transmission — raising readers and leaving libraries, both in shelves and in souls.

Moses tells the parents of Israel to “impress” God''s words on their children — the Hebrew carries the sense of engraving, of repeating until it is worn permanently into them. And the primary method is astonishingly ordinary: talk about them when you sit at home and when you walk along the road. In other words, let your children simply live near your reading. Let them see you with a book (children imitate the spines they observe far more than the sermons they endure). Read aloud to them. Fill your house with books the way other houses are filled with noise. Timothy''s faith was later traced back to exactly this — a grandmother and a mother who put the sacred writings into his childhood hands, so that “from infancy you have known the Holy Scriptures” (2 Timothy 3:15). Two women''s reading culture helped produce an apostle''s closest son in the faith.

And the flow runs beyond your own front door. Gift books to those coming up behind you. Start a reading circle. Build up the church library. Put the right volume into the right young hand at exactly the right moment — for whole destinies have pivoted on a single given book, opened by someone who was not yet ready to be reached any other way.

So here is where ten days have been leading. Read today, for it will show tomorrow. And plant readers, for they will show in generations. Go and give what you have been given.

Some of the minds your shelves will feed, you will not meet until the Day reveals the harvest.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Who actually saw you reading this month — and who, in your home or circle, could be seeing it?

— Which specific book will you place in which specific young hand, deliberately, this season?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, make my reading generational. Let my children catch the appetite, my circle catch the culture, and some young Timothy receive from my hand the very book that turns his life. Let the river You started in me keep flowing long after I am gone. Amen.

_May shelves you planted feed minds you will never meet — until the Day reveals the harvest._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Deuteronomy 6:4–9; 2 Timothy 1:5, 3:14–15$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
