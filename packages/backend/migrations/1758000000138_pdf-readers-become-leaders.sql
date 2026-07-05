-- Readers Become Leaders: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Christianity is a reading faith because it worships a speaking God. He created by words, revealed Himself in a written Book, and when He came in person, His name was the Word. To love this God is to love language, meaning, and the page.

Notice what Jesus assumed of His hearers: “Have you not read…?” — again and again. He answered the devil from the written Word, opened the scroll in Nazareth and read His own commissioning, and after resurrection He walked two disciples through “Moses and all the Prophets.” The Master was a reader.

So this plan is discipleship, not self-improvement. We read because our God writes — and every book we ever open is measured against the Book that reads us.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What is your current relationship with reading — feast, famine, or snack?

— What would it mean this month to follow a Master who asked, “Have you not read?”$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Living Word, make me a lover of the written word — beginning with Yours. Open my eyes to see wonderful things in Your law, and give me a reader's heart. Amen.

_May the Word who became flesh make every page you read a place of meeting._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$John 1:1–18; Luke 4:16–21$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Hebrews 4:12', $dev$“For the word of God is alive and active. Sharper than any double-edged sword…”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$You already know the law of the gates: whatever feeds your mind is farming your mind. Reading is deliberate agriculture — you choose the seed, you choose the field, you choose the season. No other input gives you such control over your own formation.

A mind fed on gossip grows suspicion; a mind fed on screens alone grows restless and shallow; a mind fed on great books grows large rooms — rooms of history, wisdom, empathy and vision that circumstances cannot demolish. And a mind fed on the living Word grows something sharper still: discernment that divides soul from spirit.

Poverty may surround a body, but it needs your permission to enter a mind — and books are how the siege is broken. Choose your seed today: what are you currently reading, and what is it planting?$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What has your reading (or its absence) been farming in you this year?

— Choose deliberately: what seed goes into the field next?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I take up the farmer's responsibility for my own mind. Choose the seed with me, and let this year's reading grow rooms in me that blessing can fill. Amen.

_May your mind become farmland so well-planted that every season yields wisdom._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 4:12–13; Proverbs 2:1–6$dev$),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 2:15', $dev$“Do your best to present yourself to God as one approved, a worker who does not need to be ashamed and who correctly handles the word of truth.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$There is reading that decorates and reading that nourishes — and the difference is not the book but the squeezing. Read, think; read, ponder; read, meditate — squeeze the virtue of what you are reading like you squeeze juice from an orange fruit. Pages turned are not nutrition gained.

The squeezer's tools are simple: a pen (mark what strikes you), a question (what does this mean, and what do I do with it?), a pause (stop at the sentence that burns and stay there), and a notebook (what is written down is owned; what is merely admired evaporates).

One book squeezed will change you more than twenty books skimmed. So slow down this week. You are not in a race against other readers; you are at a table, and the meal deserves chewing.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Are you a page-turner or a juice-squeezer — honestly?

— Take today's reading: what one sentence deserves a full stop and a notebook?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, deliver me from decorative reading. Teach me to squeeze — to think, ponder and meditate until the virtue of the page enters the bloodstream of my life. Amen.

_May every orange you squeeze this week fill your cup to running over._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 2:15; Psalm 119:97–104$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 1:1–3', $dev$“Blessed is the one… whose delight is in the law of the Lord, and who meditates on his law day and night. That person is like a tree planted by streams of water, which yields its fruit in season.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Here is the reader's law of harvest: if you read today, it will show tomorrow. If you don't read today — that will also show tomorrow. Either way, tomorrow tells.

Reading works like compounding interest: invisible daily, unmistakable over years. The vocabulary that carries your ideas, the judgment that navigates your decisions, the reservoir your conversations draw from, the calm of a mind that has seen how many storms end — all of it accrues page by page, or fails to.

The Psalm's tree does not strain to fruit; it fruits because of where it is planted and what it drinks daily. So plant yourself: a fixed time, a fixed place, pages before pixels. Fifteen pages a day is over five thousand pages a year — a shelf of transformation hiding inside your ordinary mornings.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— What has already “shown” in your life from reading — or from its absence?

— Fix it now: what time, what place, how many pages daily?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, plant me by the streams. I commit my daily pages — small, fixed and faithful — and I trust You for the season of fruit that will surely show. Amen.

_May your quiet daily pages compound into a visibly blessed life._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 1; Joshua 1:8$dev$),
  (5, 1, 'scripture', 'Today''s Reading', '2 Timothy 4:13', $dev$“When you come, bring the cloak that I left with Carpus at Troas, and my scrolls, especially the parchments.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$This request comes from Paul's final letter, written from a death-row cell: an old apostle, who had seen the third heaven and written half the New Testament, asking for three things — his coat, his scrolls, and especially the parchments. Facing winter and execution, Paul wanted warmth and books.

Let the scene correct us. If revelation of Paul's magnitude did not retire him from reading, no anointing retires you. If a man that near to glory still valued study, no season of life outgrows it. The learners keep leading because the leaders keep learning.

There is no arrival point where the mind may close. Whatever your age, degree or experience — somewhere there is a coat, a scroll and a parchment with your name on it. Send for them.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you quietly “retired” from learning — and when did it happen?

— What are your “parchments” — the reading your next season requires?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, give me Paul's dying appetite — still learning, still asking for the parchments. Keep my mind open and my desk stocked until the day I see You. Amen.

_May you be found, at every age, with fresh parchments open on your desk._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 4:9–13; Proverbs 18:15$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Daniel 9:2', $dev$“In the first year of his reign, I, Daniel, understood from the Scriptures, according to the word of the Lord given to Jeremiah the prophet, that the desolation of Jerusalem would last seventy years.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$One of history's mightiest prayer movements began with a man reading. Daniel, in his study of Jeremiah's scroll, understood from the Scriptures that the exile's seventy years were ending — and that understanding drove him to the fasting, sackcloth prayer of Daniel 9, which summoned the angel Gabriel with revelation that reaches to the end of the age.

Mark the sequence, for it is a whole theology of reading: the page produced understanding; understanding produced intercession; intercession produced visitation. Daniel did not stumble into his moment — he read his way into it.

There are timings, promises and assignments waiting in texts you have not yet opened — in the Word first, and in the wisdom of the ages besides. Some breakthroughs are not being withheld. They are being unread.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What might currently be “unread” in your life — promises or wisdom waiting in unopened texts?

— What understanding, if you gained it, would change how you pray?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$God of Daniel, let my reading produce understanding, my understanding produce prayer, and my prayer produce visitation. Show me the scroll for my season. Amen.

_May something you read this month send you to your knees — and heaven to your door._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Daniel 9:1–23; Jeremiah 29:10–14$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Deuteronomy 17:18–19', $dev$“When he takes the throne of his kingdom, he is to write for himself on a scroll a copy of this law… It is to be with him, and he is to read it all the days of his life.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Before Israel ever had a king, God legislated the king's reading habits: on taking the throne, he must personally hand-copy the Book, keep it beside him, and read it all the days of his life — “so that he may learn to revere the Lord… and not consider himself better than his fellow Israelites.”

Heaven's logic is plain: authority without daily reading becomes arrogance; power without the page drifts. The bigger your responsibility — home, business, ministry, office — the more binding the king's law becomes on you. Leaders who stop reading start assuming, and people pay for leaders' assumptions.

Notice too the method: write for himself — slow, personal, by hand. Copy out the texts that must govern you; what passes through your own hand governs deeper than what passes before your eyes. Readers become leaders — and remain safe ones.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— As responsibility has grown, has your reading grown with it — or thinned?

— What governing text will you hand-copy this week, king-style?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, bind the king's law on me: the Book beside me, read all my days, copied by my own hand — so that authority never outgrows reverence in me. Amen.

_May every increase of your authority be matched by an increase of your reading._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Deuteronomy 17:14–20; 1 Kings 2:1–4$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Proverbs 9:9', $dev$“Instruct the wise and they will be wiser still; teach the righteous and they will add to their learning.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$The good thing with reading is that you can bring the world to your room. For the price of a book, Solomon tutors you in wisdom, Paul in grace, and the great men and women of every age in leadership, finance, healing and prayer. Mentors who would never fit in your schedule sit patiently on your shelf, available at midnight.

This is God's mercy to the man of humble beginnings: the boy who missed school terms can still out-learn his generation, because libraries do not check family names. Many walls that poverty builds, reading quietly dismantles.

So build your council of paper mentors deliberately: biographies of the greatly used, the classics of prayer and faith, the craft books of your calling. Choose mentors whose fruit you would want — for whoever disciples your mind will eventually direct your feet.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Who currently sits on your “council of paper mentors” — and who is missing?

— Which biography or classic will you appoint to the council this month?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, assemble my council. Bring to my room, through books, the mentors my becoming requires — and give me the humility to sit at their feet. Amen.

_May your small room host the wisest company in the world._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 9:9–12; 13:20$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Philippians 4:8', $dev$“Finally, brothers and sisters, whatever is true, whatever is noble… think about such things.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$A serious reader needs one more instrument: a filter. Not every page deserves your bloodstream — some books carry sweet-tasting error, and an undiscerning reader farms weeds with great diligence. “Test them all; hold on to what is good” (1 Thessalonians 5:21).

The filter is the Book itself. Scripture is the standard weight against which every idea is measured: read widely, but weigh biblically. When an author's counsel contradicts the Word, the author loses — however famous the name or beautiful the prose. The Bereans were called noble precisely for this: they received teaching eagerly and examined the Scriptures daily to see if it was true (Acts 17:11).

So keep the Word central in your reading life — the first book of the day, the lens for all the others. Readers who weigh become leaders who cannot be easily deceived.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you currently read with a filter, or does everything get equal access?

— Where has a persuasive book quietly out-voted Scripture in your thinking?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, make Your Word the scale on my desk. I will read widely and weigh everything — holding fast the good, releasing the rest, deceived by none. Amen.

_May you grow into a reader whom error finds difficult and truth finds hospitable._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 17:10–12; 1 Thessalonians 5:19–22$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Deuteronomy 6:6–7', $dev$“These commandments that I give you today are to be on your hearts. Impress them on your children. Talk about them when you sit at home and when you walk along the road…”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Your reading life was never meant to end with you. The final movement of a reader's becoming is transmission: raising readers, and leaving libraries — in shelves and in souls.

Impress the words on your children: let them see you reading (children imitate spines they observe), read to them, fill the house with books the way other houses are filled with noise. Timothy's faith was traced to a grandmother and mother who put the sacred writings in his childhood hands (2 Timothy 1:5; 3:15). Two women's reading culture produced an apostle's son.

And beyond your house: gift books, start a reading circle, build the church library, put the right volume in the right young hand at the right moment. Whole destinies have pivoted on a given book. Go now — read today, for it will show tomorrow; and plant readers, for they will show in generations.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Who saw you reading this month — and who could?

— Which book will you place in which young hand, deliberately, this season?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, make my reading generational. Let my children catch the appetite, my circle catch the culture, and some young Timothy receive from my hand the book that turns his life. Amen.

_May shelves you planted feed minds you will never meet — until the Day reveals the harvest._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Deuteronomy 6:4–9; 2 Timothy 1:5, 3:14–15$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
