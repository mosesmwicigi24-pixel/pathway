-- Speak Life: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
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
  (1, 1, 'scripture', 'Today''s Reading', 'Romans 4:17', $dev$“As it is written: “I have made you a father of many nations.” He is our father in the sight of God, in whom he believed — the God who gives life to the dead and calls into being things that were not.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Begin with your Father's way of working: He calls into being things that were not. “Let there be light” — and light obeyed a sentence. And notice how He renamed a childless old man “father of many nations” before a single son was born. God speaks in line with the destiny, not the diagnosis.

Then came the Son — and words obeyed Him too. He spoke to a storm and it slept; to a fig tree and it withered; to a dead man and Lazarus came out. Never once did Jesus merely describe a situation. He addressed it.

You are made in this speaking God's image, redeemed by His speaking Son. This plan's premise is simple: it is time your mouth joined the family business.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Do your words mostly describe your situations or address them?

— What has God “named” over your life that your mouth has not yet agreed with?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, You call things that are not as though they were. Lord Jesus, every storm knew Your voice. Teach my tongue the family language — I am ready to speak life. Amen.

_May your mouth learn this week the language your Father has always spoken._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 4:16–21; Genesis 1; Mark 4:39$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Proverbs 18:21', $dev$“The tongue has the power of life and death, and those who love it will eat its fruit.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Words are seeds: when you speak something out, you give life to what you have said, and eventually it becomes a reality on your table. You are eating today, in mood and momentum, the fruit of sentences you planted last season.

If you want apples, you do not plant thorns. Yet listen to how we plant: I'm always broke. Nothing works for me. I can't. You cannot talk defeat and expect victory; you cannot talk lack and harvest abundance. If you have a poor mouth, you are going to have a poor life.

The same law works gloriously in reverse. Start speaking words of victory — plant the seed of victory and you shall eat its fruit. Your tongue is a farm implement. Today, choose your seed bag.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What fruit currently on your table can you trace back to your own repeated words?

— What three “victory seeds” will you begin planting daily?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I take responsibility for my planting. I empty the seed bag of defeat and I fill my mouth with words of life. Give me a harvest worth eating. Amen.

_May your next harvest prove that your seed changed._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 18:20–21; 12:14$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'James 3:2', $dev$“For we all stumble in many ways. Anyone who is never at fault in what they say is perfect, able to keep their whole body in check.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Whether you realize it or not, you are prophesying your future. Your life will move in the direction of your words — and it has been doing so all along. The person who says “I always fail interviews” walks into the room with that prophecy on their face; the body obeys the sentence.

Psychology calls it self-fulfilling expectation. Scripture knew it first: your saying reveals your believing, “for the mouth speaks what the heart is full of” (Luke 6:45) — and then your believing, spoken, steers your becoming.

So conduct an audit today: if a stranger wrote down everything you said about yourself this week and read it back as a prophecy — is that the future you want? If not, the correction does not begin at your circumstances. It begins at your mouth.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— What did you prophesy over yourself this week, sentence by sentence?

— Which recurring phrase must be struck from your record?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, forgive the false prophecies I have spoken over my own head. From today, let my mouth agree only with the future You have written for me. Amen.

_May every sentence you speak this week be one you would gladly see fulfilled._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$James 3:1–2; Luke 6:43–45$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'James 3:4', $dev$“Take ships as an example. Although they are so large and are driven by strong winds, they are steered by a very small rudder wherever the pilot wants to go.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$A ship is directed by its rudder and a horse is controlled by its bridle — and as they are steered, so your tongue steers and directs your destiny. James is amazed at the ratio: something so small, governing something so large.

This is wonderful news, not frightening news. It means you do not need to wrestle your whole enormous life into a new direction — you need to gain the rudder. Change the persistent words, and the vessel begins, degree by degree, to turn.

The tongue will guide you into a storm, or it will guide you into safe harbor; the rudder is never neutral. So take the helm deliberately: set your course by the Word, speak that course daily, and let the small muscle steer the great ship toward the harbor God has named.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Toward what harbor are your current words steering — honestly?

— What course-setting sentence will you speak each morning this week?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Lord, I take the rudder. I set my course by Your Word, and I will hold it with my words — degree by degree, into safe harbor. Amen.

_May your small rudder steer your great ship into God's safe harbor._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$James 3:3–6; Psalm 141:3$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Proverbs 6:2', $dev$“You are snared by the words of your mouth; you are caught by the words of your mouth.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Sometimes the enemy does not have to defeat us — we defeat ourselves with the words we speak. I could never lead. I'm not the marrying type. My family has always been poor. Each sentence a knot; enough sentences, a snare — and a man wonders who tied him.

The trap works quietly: spoken limits become believed limits, believed limits become attempted limits, and attempted limits become your life. Nobody imprisoned you. You testified against yourself, and your future accepted the testimony.

But snares of words can be broken by words. Today, revoke specific sentences: name them, renounce them, and replace them aloud. “I withdraw the words ‘I could never…’ — I declare instead: I can do all things through Christ who strengthens me.” The mouth that tied the knot can untie it — under a stronger Word than its own.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which self-spoken sentence has snared you longest?

— Write its revocation and its replacement — then say both aloud.$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I revoke every sentence I spoke against my own destiny. The snare is cut in Jesus' name. My mouth now testifies for me, not against me. Amen.

_May every knot your words ever tied come loose today._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 6:2; Matthew 12:36–37$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '1 Thessalonians 1:3', $dev$“We continually remember before our God and Father your work produced by faith, your labor prompted by love, and your endurance inspired by hope in our Lord Jesus Christ.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$In your life there are two voices fighting for your attention: the voice of faith and the voice of defeat. Both offer you scripts all day long, and whichever script your mouth reads aloud gains power.

The voice of defeat is fluent in facts: the balance, the diagnosis, the history. But facts are not necessarily truth — you can hold all the facts of a matter while the truth remains with God. The fact was that Lazarus was dead; the truth was that Jesus was on the way.

The voice of faith does not deny facts; it outranks them, the way a king's decree outranks a rumor. So choose your reader: when both scripts arrive tomorrow — and they will — pause, and deliberately read faith's page aloud. The battle for your future is fought at the microphone of your mouth.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Which voice has been getting your microphone at day's end?

— Name a “fact” in your life that God's truth outranks. Say the truth aloud.$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, I give the microphone to the voice of faith. Facts will inform me, but only Your truth will be quoted by my lips. Amen.

_May the voice of faith win every argument held in your mouth this week._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Numbers 13:30–14:9; 2 Corinthians 4:13$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Luke 6:45', $dev$“A good man brings good things out of the good stored up in his heart… For the mouth speaks what the heart is full of.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$There is a limit to managing your mouth directly, and Jesus names it: the mouth is a bucket, and it draws from the well of the heart. Squeeze the bucket all you like — under pressure, whatever fills the well is what spills. Your words in a crisis are your heart taking an exam.

The reaction you give to a hurting situation reveals what you are truly full of; the ability to keep a level head and sound words under fire is the mark of maturity being formed.

So the deepest speech therapy is well-filling: Scripture read aloud, worship in the house, testimonies rehearsed, thanksgiving practiced. Fill the well with life for thirty days and listen to what starts spilling when life squeezes you. Changed springs change streams.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— What spilled out of you at your last squeezing — and what does it reveal about the well?

— What will you pour into the well, daily, for the next thirty days?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord, work below my words. Fill the well of my heart with Your Word and Your praise, until even my under-pressure sentences taste of life. Amen.

_May your well be so full of life that pressure can only make you overflow._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 6:43–45; Colossians 3:16$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Psalm 103:20', $dev$“Praise the Lord, you his angels, you mighty ones who do his bidding, who obey his word.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is a mystery that will dignify every verse you ever quote: angels excel in power, and they move at the sound of God's word. Not at complaints. Not at commentary. At His word.

This is why speaking Scripture is different from speaking positivity. Positive words improve your psychology — a good gift. But God's Word, spoken, engages heaven's machinery: “He sent out his word and healed them” (Psalm 107:20); “my word… will not return to me empty” (Isaiah 55:11).

So address every situation with the Word of God — family, business, body, destiny. Do not merely talk about the mountain to God; take His Word and speak to the mountain in His name. When your mouth carries His sentences, unseen servants recognize the signature.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which situation have you discussed endlessly but never addressed with Scripture aloud?

— Find one verse for it today. Speak it over the situation, morning and night.$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, put Your Word in my mouth for every battle I face. As I speak what You have said, let heaven's mighty ones recognize the signature and move. Amen.

_May your quoted verses be recognized in realms your eyes cannot see._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 103:20; Isaiah 55:10–11; Acts 20:32$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Mark 11:23', $dev$“Truly I tell you, if anyone says to this mountain, ‘Go, throw yourself into the sea,’ and does not doubt in their heart but believes that what they say will happen, it will be done for them.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Read the verse carefully and notice what Jesus did not say. He did not say “pray about the mountain.” He said says to this mountain — speech, aimed at the obstacle, loaded with faith. Prayer petitions God; declaration addresses the problem. The believer needs both.

Notice also the ratio in the verse: one “believes in the heart,” but “says” appears with the mountain, the command and the promise. Many believers have faith locked in their hearts that has never once been issued through their mouths — an army never deployed.

So identify your mountain today — the obstacle, not the people near it — and speak to it by name, in the name of Jesus, with the Word of God. It has been listening to your fear for years. Let it finally hear your faith.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you been talking about your mountain or to it?

— Write the exact sentence of command you will speak — then speak it.$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I believe — and now I say. To every mountain standing between me and the life You wrote: move, in Jesus' name. I will not doubt in my heart. Amen.

_May the mountains that heard your fear now hear your faith — and move._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 11:20–24; Zechariah 4:6–7$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Isaiah 49:2', $dev$“He made my mouth like a sharpened sword, in the shadow of his hand he hid me; he made me into a polished arrow and concealed me in his quiver.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Here is your commissioning image: God fashions servants whose mouths are sharpened swords and polished arrows — words with edge, direction and appointed targets. Ten days of training were not for decoration; heaven arms mouths it can trust.

But a sword this sharp needs one final safeguard: “Out of the same mouth come praise and cursing. My brothers and sisters, this should not be” (James 3:9–10). The tongue that blesses God must not curse His image-bearers — including the one in your mirror. Bless your children, your spouse, your colleagues, yourself; prophesy good over people, not evil.

So go now with the family language on your lips: “I believed; therefore I have spoken” (2 Corinthians 4:13). Speak life at home, over your work, into your body, toward your destiny — and stay in the quiver, ready for the moments God aims you.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Over whom will you deliberately speak blessing this week — by name?

— What daily declaration set will you carry from this plan for life?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, make my mouth a sharpened sword in Your hand — never against Your children, always for Your purposes. I will speak life all the days written in my book. Amen.

_May your words be swords in God's hand and springs in people's deserts — all your days._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 49:1–3; James 3:9–12; Numbers 6:24–26$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
