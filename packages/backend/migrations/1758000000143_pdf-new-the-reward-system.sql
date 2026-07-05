-- The Reward System (15 days): NEW plan seeded from the author's PDF (source of truth).
-- Each day: key verse (scripture) -> Devotional -> Talk it Over (Reflect) ->
-- Pray (+blessing) -> Go Deeper. No videos. Re-runnable: plan upserts by code
-- and days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('the-reward-system', 'The Reward System', 'Fifteen days inside heaven''s laws of favor, honor and harvest — the system God built to bless you.', 'The Kingdom of God is not random. Behind every blessing you have ever admired stands a system — laws of seed and harvest, favor and honor, asking and receiving — set in motion at creation and still running today. “As long as the earth endures, seedtime and harvest… will never cease” (Genesis 8:22). Many believers live poor inside a wealthy system, the way a man starves in front of a farm he never learned to plant. This plan is the farm tour. For fifteen days we walk heaven''s reward system: the favor that opens what effort cannot, the honor that guards what favor opens, the giving that plants what harvest returns — and the Rewarder Himself, who sees in secret and repays in the open.', 'Faithfulness', 15, 29, 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'the-reward-system');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Hebrews 11:6', 'Your God Is a Rewarder'),
  (2, 'Genesis 8:22', 'The Law of Seed and Harvest'),
  (3, 'Psalm 5:12', 'Until Favor Shows Up'),
  (4, 'James 4:6', 'Positioned for Favor'),
  (5, 'Matthew 10:41', 'The Law of Honor'),
  (6, 'Esther 1:12', 'Vashti: Never Forget Where You Stand'),
  (7, 'Esther 2:17', 'Esther: Honor Wears a Crown'),
  (8, 'Proverbs 3:9–10', 'Firstfruits: The Seed That Honors'),
  (9, '2 Samuel 24:24', 'What Costs Me Nothing'),
  (10, 'Proverbs 19:17', 'Lending to the Lord'),
  (11, 'Luke 6:35', 'The Reward Nobody Competes For'),
  (12, 'Matthew 6:3–4', 'The Father Who Sees in Secret'),
  (13, 'Hebrews 10:35–36', 'Do Not Throw Away Your Confidence'),
  (14, 'Colossians 3:23–24', 'Work as Worship, Wages From Heaven'),
  (15, 'Matthew 25:21', 'Steward of the System')
) AS v(n, ref, title) WHERE p.code = 'the-reward-system';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'the-reward-system'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Hebrews 11:6', $dev$“And without faith it is impossible to please God, because anyone who comes to him must believe that he exists and that he rewards those who earnestly seek him.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Before you learn the system, meet its Owner — and correct the picture many carry of Him. God is not a reluctant paymaster squeezed for blessings. Rewarding is His declared nature: to come to Him at all, Scripture says, you must believe two things — that He is, and that He rewards seekers.

The risen Christ’s last announcement carries the same heartbeat: “Look, I am coming soon! My reward is with me” (Revelation 22:12). From Genesis to Revelation, heaven runs on remembered labor and repaid faithfulness: “God is not unjust; he will not forget your work” (Hebrews 6:10).

So enter these fifteen days with the posture the system requires: expectation. Not entitlement — expectation. A farmer who doubts harvest plants carelessly; a believer who doubts the Rewarder sows the same way. Settle it on day one: the system is real because the Rewarder is good.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you secretly pictured God as a reluctant paymaster? Where did that picture come from?

— What would you sow differently if you truly expected harvest?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, I correct the picture: You are a Rewarder — it is Your nature and Your delight. I enter Your system with expectation, and I will learn its laws with joy. Amen.

_May the goodness of the Rewarder rewrite every low expectation you have carried._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 11:6; 6:10; Revelation 22:12$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Genesis 8:22', $dev$“As long as the earth endures, seedtime and harvest, cold and heat, summer and winter, day and night will never cease.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$The first law of the reward system was written into creation itself: everything reproduces after its kind, through seed. And the law runs far beyond the farm. Listening is the seed of learning. A question is a seed for an answer. Kindness is the seed of relationships; diligence, the seed of skill; forgiveness, the seed of peace.

This means nothing in your life is stagnant — everything is either seed going in or harvest coming out. The mood of your home, the state of your finances, the depth of your walk with God: harvests, all of them, traceable to plantings.

The law’s severity is also its mercy: change the seed and the harvest must change — the system has no favorites and no exceptions. So audit like a farmer today: which harvests do you love? Keep those seeds. Which do you dread? The seed bag is in your hands.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— Trace one harvest in your life — good or hard — back to its seed.

— What new seed enters the ground this week?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Creator of seedtime and harvest, make me a deliberate farmer of my whole life. I choose my seed today — and I trust Your unfailing law for the crop. Amen.

_May every furrow of your life receive seed you will rejoice to harvest._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 8:22; Galatians 6:7–9$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Psalm 5:12', $dev$“Surely, Lord, you bless the righteous; you surround them with your favor as with a shield.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Anybody who tells you it is impossible is right — until favor shows up. Favor is the reward system’s accelerator: the touch of God that does in a day what labor alone could not do in a decade.

Watch it operate on Joseph: a slave, yet “the Lord was with him… and gave him favor” — in Potiphar’s house, in the prison, before Pharaoh. Same man, same chains, but favor kept promoting him through impossible doors. Watch it on Ruth, a foreign widow gleaning leftovers: “Why have I found such favor in your eyes?” — and by harvest’s end she stood inside the lineage of Christ.

Favor does not replace your diligence; it multiplies it — Joseph still worked, Ruth still gleaned. So work with all your heart, and pray over the work daily: “establish thou the work of our hands” (Psalm 90:17). Then watch what the shield does to the impossibilities.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has “impossible” been pronounced over your situation?

— Where have you already seen favor accelerate what effort alone could not?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Lord, surround me with favor as with a shield. I will bring the diligence; You bring the acceleration — and let every “impossible” wait for favor to show up. Amen.

_May favor show up this season exactly where the experts said impossible._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 39:2–6, 20–23; Ruth 2:8–13$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'James 4:6', $dev$“But he gives us more grace. That is why Scripture says: “God opposes the proud but shows favor to the humble.””$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Favor cannot be earned — that is what makes it favor. But Scripture shows it can be positioned for, and the positions are consistent. Humility: God gives favor to the humble the way water flows to low ground. Faithfulness in service: Joseph found favor while serving another man’s house. The presence of God treasured: Mary was “highly favored” because “the Lord is with you” (Luke 1:28) — favor follows His nearness.

And wisdom’s road: “Then you will win favor and a good name in the sight of God and man” follows the keeping of love and faithfulness (Proverbs 3:3–4).

So stop chasing favor and start occupying its addresses: the low place, the servant’s post, the secret place of His presence. Favor knows those addresses well — it has been visiting them for thousands of years.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Which of favor’s addresses — humility, service, His presence — needs your occupancy?

— Where has pride quietly blocked what favor wanted to do?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, position me: low in heart, faithful in service, near to You. I stop chasing favor and start dwelling where it visits. Amen.

_May favor find you at home at its favorite addresses._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$James 4:6–10; Proverbs 3:1–4; Luke 1:26–30$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Matthew 10:41', $dev$“Whoever welcomes a prophet as a prophet will receive a prophet’s reward, and whoever welcomes a righteous person as a righteous person will receive a righteous person’s reward.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Here is one of the least-taught laws in the reward system: honor is a seed, and it harvests according to what it recognizes. Receive a prophet as a prophet — recognizing what God has placed in him — and the prophet’s reward flows to you. The blessing travels on the rails of recognition.

The law works fearfully in reverse: in Nazareth, where Jesus was “just the carpenter’s son,” He “did not do many miracles there because of their lack of faith” (Matthew 13:57–58). Same Jesus, same power — dishonor closed the tap.

And notice honor’s first commandment carries the system’s first promise: “Honor your father and mother… that it may go well with you and that you may enjoy long life” (Ephesians 6:2–3). Honor is grace in action. Audit your honor today: parents, spiritual leaders, elders, authorities — where recognition has grown thin, so has the flow.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Whom has God placed in your life that you have received casually rather than honorably?

— Where will you sow deliberate honor this week — and how, practically?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, teach me the law of honor. Open my eyes to recognize what You have placed in people — and let the rewards that travel on honor find a highway in me. Amen.

_May the rewards that travel on honor find your house by the main road._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 10:40–42; 13:53–58; Ephesians 6:1–3$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Esther 1:12', $dev$“But when the attendants delivered the king’s command, Queen Vashti refused to come. Then the king became furious and burned with anger.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Vashti forgot that she was a queen because she married a king. Familiarity had quietly re-taught her the mathematics of her position — until the day she dishonored the very throne her crown depended on, and lost both in an evening.

Here is the principle her story guards: no matter how close you are to greatness, never forget that you are standing before greatness. The spouse you now correct casually, the mentor whose calls you delay returning, the church you now critique like a customer, the God you approach without wonder — closeness was meant to deepen honor, not dissolve it.

Familiarity is honor’s rust; it forms silently on every long relationship. So polish deliberately: recover the language of respect at home, gratitude toward the people of your growth, awe in the presence of God. Positions are kept the way they were received — with honor.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has familiarity rusted your honor — home, church, mentorship, the presence of God?

— What would “polishing” look like there this very week?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, save me from Vashti’s forgetting. Where closeness has bred casualness, restore my wonder — I will honor the greatness I stand before, beginning with You. Amen.

_May you never lose by familiarity what you gained by grace._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Esther 1:9–21$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Esther 2:17', $dev$“Now the king was attracted to Esther more than to any of the other women, and she won his favor and approval more than any of the other virgins. So he set a royal crown on her head.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Where Vashti’s dishonor lost a crown, Esther’s honor won one. Trace her manner through the book: she followed Mordecai’s counsel “just as she did when he was bringing her up”; she asked for nothing beyond what Hegai advised; she approached the king by protocol, touching the sceptre; even her banquets honored before they requested.

And see what the honorable posture carried: a crown, the king’s ear, and finally the deliverance of a whole nation. Honor is not weakness dressed politely — it is positioning; it put Esther in the room where destiny needed someone standing.

The same law crowned Ruth (“I have been told all about what you have done for your mother-in-law”) and promoted Daniel before kings. In a generation fluent in demands and allergic to protocol, the honorable stand out like royalty — because, in the reward system, they are being fitted for crowns.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Whose “sceptre” — proper channel, right protocol, due respect — have you been bypassing?

— What request in your life might be waiting on a more honorable approach?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, clothe me in Esther’s spirit — counsel received, protocol honored, requests made with grace. Position me by honor in the rooms my assignment requires. Amen.

_May honor fit you quietly for crowns that demanding could never seize._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Esther 2:8–18; 5:1–8$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Proverbs 3:9–10', $dev$“Honor the Lord with your wealth, with the firstfruits of all your crops; then your barns will be filled to overflowing, and your vats will brim over with new wine.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$The laws of honor and harvest meet at your income. “Honor the Lord with your wealth, with the firstfruits” — the first portion, not the leftovers; the seed given before the harvest is certain, which is exactly why it carries faith.

The tithe and the firstfruit are not God fundraising — heaven has no deficits. They are God heart-guarding: “where your treasure is, there your heart will be also” (Matthew 6:21). The first tenth, given gladly, keeps the Provider enthroned above the provision, and pries the fingers of fear off your supply.

And it is the one place God invites an audit: “Test me in this… and see if I will not throw open the floodgates of heaven” (Malachi 3:10). Millions of believers across generations have run the test and signed the same report: the ninety percent, blessed, outperforms the hundred percent, hoarded.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Does God receive your firstfruits or your leftovers — honestly?

— What does your giving pattern say about where your trust sits?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Provider God, receive my first and best — not as tax but as honor. I run Your test with joy, and I trust the floodgates more than my fists. Amen.

_May open hands find open floodgates, all your days._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 3:9–10; Malachi 3:8–12$dev$),
  (9, 1, 'scripture', 'Today''s Reading', '2 Samuel 24:24', $dev$“But the king replied to Araunah, “No, I insist on paying you for it. I will not sacrifice to the Lord my God burnt offerings that cost me nothing.””$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Araunah offered David the threshing floor, the oxen, the wood — free, to a king. And David gave the reward system one of its royal sentences: I will not sacrifice to the Lord my God burnt offerings that cost me nothing. He understood that the power of an offering is measured at the giver’s end, by what it costs, not at the altar’s end, by what it totals.

Jesus taught the same accounting outside the temple treasury: the widow’s two small coins outweighed the large gifts of the wealthy, “for she out of her poverty put in everything” (Mark 12:44). Heaven weighs sacrifice, not size.

This dignifies every giver: the smallest purse can make the heaviest offering. And it searches every giver: has your giving cost you anything lately — in comfort, in convenience, in plans surrendered? Sacrificial seed carries a harvest that convenient seed has never known.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— When did your giving last actually cost you something?

— What “Araunah shortcut” — the costless option — is before you now?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Lord, teach me David’s arithmetic. Let my offerings carry weight at my end of the scale — and receive, from my little or my much, gifts that truly cost. Amen.

_May your costliest seed return your testimony’s greatest harvest._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$2 Samuel 24:18–25; Mark 12:41–44$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Proverbs 19:17', $dev$“Whoever is kind to the poor lends to the Lord, and he will reward them for what they have done.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Here is the safest investment on earth: kindness to the poor is registered in heaven as a loan to God — and the Borrower has never defaulted. What you place in a hand that cannot repay you, heaven signs for personally.

Jesus pushed it further than metaphor: “whatever you did for one of the least of these brothers and sisters of mine, you did for me” (Matthew 25:40). The hungry stomach you fill, the school fees you quietly pay, the widow’s roof you mend — He takes them as done to Himself.

And remember this wonder: if Egypt can bless Israel, then anybody can bless you — God can raise helpers for you from the most unexpected quarters, for someone will wake up covenanted to ensure you are blessed. The generous live inside that circulation: giving into unexpected hands, receiving from unexpected ones. Enter the circulation deliberately this week.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Who around you cannot repay — and is therefore heaven’s invitation?

— Have you ever been blessed from a totally unexpected quarter? Thank God for it now.$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, I open the account: my kindness to the least, received as loans by You. Keep me in the holy circulation — giving without calculation, receiving without anxiety. Amen.

_May unexpected hands bless you in seasons you never advertised your need._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 19:17; Matthew 25:34–40; Luke 6:38$dev$),
  (11, 1, 'scripture', 'Today''s Reading', 'Luke 6:35', $dev$“But love your enemies, do good to them, and lend to them without expecting to get anything back. Then your reward will be great, and you will be children of the Most High.”$dev$),
  (11, 2, 'devotional', 'Devotional', NULL, $dev$Every reward in the system has admirers — except this one. The queue for “love your enemies” is always short. Yet Jesus attaches to it one of the largest promises in the gospels: your reward will be great, and you will be children of the Most High — family resemblance, publicly confirmed.

Why so great a reward? Because nothing on earth looks more like God: “He causes his sun to rise on the evil and the good” (Matthew 5:45). Anyone can bless a friend; grace is only visible when it flows uphill, toward the undeserving — as it flowed toward us at the cross while we were still enemies (Romans 5:10).

So identify the person this verse names in your life — the betrayer, the critic, the one who cost you. Bless them practically this week: a prayer by name, a kind word, a door opened. It will cost your flesh everything — which is exactly why the reward is great.$dev$),
  (11, 3, 'talk', 'Talk it Over', NULL, $dev$— Who is the “enemy” this teaching names in your life right now?

— What practical good — prayer, word, deed — will you do them this week?$dev$),
  (11, 4, 'devotional', 'Pray', NULL, $dev$Father, I enroll for the reward nobody competes for. Give me grace to love uphill — and let my enemies’ blessing become my family resemblance certificate. Amen.

_May loving the undeserving make you unmistakably like your Father._$dev$),
  (11, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 6:27–36; Romans 12:17–21$dev$),
  (12, 1, 'scripture', 'Today''s Reading', 'Matthew 6:3–4', $dev$“But when you give to the needy, do not let your left hand know what your right hand is doing, so that your giving may be in secret. Then your Father, who sees what is done in secret, will reward you.”$dev$),
  (12, 2, 'devotional', 'Devotional', NULL, $dev$Three times in one chapter — over giving, prayer and fasting — Jesus repeats the same banking instruction: do it in secret, “and your Father, who sees what is done in secret, will reward you.” The reward system has two payout windows, and every act chooses its window: applause now, or the Father’s reward later. “They have received their reward in full,” He says of the performers — a receipt already settled, nothing further owed.

Secrecy is not shame; it is address selection. The hidden gift, the unseen fast, the intercession nobody hears — these are deposits routed past human eyes directly to the Father’s ledger, where nothing is ever lost.

So build a secret portfolio this season: one giving, one serving, one discipline that no living person knows about. The world is too busy to stand and admire you anyway — but One is not too busy. He sees. He records. He rewards.$dev$),
  (12, 3, 'talk', 'Talk it Over', NULL, $dev$— How much of your goodness currently requires an audience?

— What will enter your “secret portfolio” this month — unseen by all but One?$dev$),
  (12, 4, 'devotional', 'Pray', NULL, $dev$Father who sees in secret, I change payout windows. Route my best acts past every audience to Your ledger — Your “well done” is the only receipt I want. Amen.

_May your secret deposits mature into open rewards at the perfect time._$dev$),
  (12, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 6:1–18$dev$),
  (13, 1, 'scripture', 'Today''s Reading', 'Hebrews 10:35–36', $dev$“So do not throw away your confidence; it will be richly rewarded. You need to persevere so that when you have done the will of God, you will receive what he has promised.”$dev$),
  (13, 2, 'devotional', 'Devotional', NULL, $dev$Every farmer knows the dangerous months: seed in the ground, nothing showing, bills due. The reward system has the same months — the gap between sowing and reaping where most quitting happens. Scripture legislates for exactly that gap: do not throw away your confidence; it will be richly rewarded.

Notice the verse treats confidence as property — something you own and could foolishly discard, like a man burning title deeds because the harvest is late. And the companion verse gives harvest’s one condition: “at the proper time we will reap a harvest if we do not give up” (Galatians 6:9). Not if we sow perfectly — if we do not give up.

Your seed is in the ground: the giving, the honor, the secret faithfulness of these fifteen days and the years before them. The proper time is on heaven’s calendar. Hold the title deeds.$dev$),
  (13, 3, 'talk', 'Talk it Over', NULL, $dev$— Where are you currently in the “dangerous months” — seed down, nothing showing?

— What does “not throwing away confidence” look like there, practically?$dev$),
  (13, 4, 'devotional', 'Pray', NULL, $dev$Father, I grip the title deeds. My seed is in Your ground and my times are in Your hands — I will not quit in the months between sowing and reaping. Amen.

_May your proper time arrive and find your confidence intact._$dev$),
  (13, 5, 'reading', 'Go Deeper', NULL, $dev$Hebrews 10:32–39; Galatians 6:9–10$dev$),
  (14, 1, 'scripture', 'Today''s Reading', 'Colossians 3:23–24', $dev$“Whatever you do, work at it with all your heart, as working for the Lord… since you know that you will receive an inheritance from the Lord as a reward. It is the Lord Christ you are serving.”$dev$),
  (14, 2, 'devotional', 'Devotional', NULL, $dev$The reward system does not pause on Monday morning. Paul wrote today’s verse to workers whose earthly masters might never pay them fairly — and he re-routed their payroll: work with all your heart, as for the Lord, and receive your inheritance from the Lord as reward.

This changes every under-appreciated season. The diligence your employer overlooks, the excellence your customers never notice, the integrity that cost you the deal — none of it fell on the floor. It is the Lord Christ you are serving, and His books balance perfectly.

So bring the whole system to your work: sow excellence as seed, honor those over you, serve as unto Him, and keep some diligence in the secret portfolio. Deuteronomy names the source plainly: “remember the Lord your God, for it is he who gives you the power to get wealth” (8:18). Same Employer, better contract.$dev$),
  (14, 3, 'talk', 'Talk it Over', NULL, $dev$— Where has under-appreciation tempted you to reduce your excellence?

— What changes when Christ is named as the true Employer of your week?$dev$),
  (14, 4, 'devotional', 'Pray', NULL, $dev$Lord Christ, I re-route my payroll to You. Receive this week’s work as worship — every unseen excellence, every honest hour — and reward it from Your unfailing books. Amen.

_May every overlooked excellence of yours be found perfectly recorded in better books._$dev$),
  (14, 5, 'reading', 'Go Deeper', NULL, $dev$Colossians 3:22–25; Deuteronomy 8:17–18$dev$),
  (15, 1, 'scripture', 'Today''s Reading', 'Matthew 25:21', $dev$“His master replied, “Well done, good and faithful servant! You have been faithful with a few things; I will put you in charge of many things. Come and share your master’s happiness!””$dev$),
  (15, 2, 'devotional', 'Devotional', NULL, $dev$Fifteen days in the system, and here is its summit: in the Kingdom we do not own things — we are stewards. The favor, the harvests, the honor-opened doors — all of it is the Master’s property in your management, and management is what the final review will measure.

Hear the sequence of the “well done”: faithful with few → ruler over many → share your master’s happiness. The ultimate reward of the reward system is not the barns or the crowns. It is joy — His joy, shared. Every law you have learned was always aimed there.

So go and run the system as a steward: sow deliberately, honor consistently, give sacrificially, love uphill, bank in secret, endure the gap, work as worship. And keep the summit in view: one Day, one Face, one sentence — Well done. Everything else was seed.$dev$),
  (15, 3, 'talk', 'Talk it Over', NULL, $dev$— Which of the system’s laws will you build into permanent practice — name three?

— How does living for the final “Well done” reorder this month’s priorities?$dev$),
  (15, 4, 'devotional', 'Pray', NULL, $dev$Master, I take up full stewardship of Your system. Find me faithful with the few, fit me for the many — and above every reward, reserve me a share of Your happiness. Amen.

_May you live so faithfully inside heaven’s system that “Well done” is already being drafted over your name._$dev$),
  (15, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 25:14–30; 1 Corinthians 4:1–2$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
