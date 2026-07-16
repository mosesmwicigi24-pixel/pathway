-- Seed real day-by-day content for three reading plans that shipped with a
-- day_count but no days/segments (Gospel of John was only 4 partial days). Each
-- day: reference + title + three segments (Today's Reading -> Devotional -> Talk
-- it Over). Idempotent on code / (plan, day) / per-day segment existence.

-- Up Migration

-- ======================================================================
-- gospel-of-john  (21 days)
UPDATE reading_plans SET day_count = 21 WHERE code = 'gospel-of-john';
-- Clear the 4 partial, differently-referenced days so the clean 21 seed cleanly.
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'gospel-of-john');

INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title
FROM reading_plans p
CROSS JOIN (VALUES
  (1, 'John 1', 'The Word Became Flesh'),
  (2, 'John 2', 'The First Sign'),
  (3, 'John 3', 'Born Again'),
  (4, 'John 4', 'Living Water'),
  (5, 'John 5', 'Do You Want to Be Well?'),
  (6, 'John 6', 'The Bread of Life'),
  (7, 'John 7', 'Rivers of Living Water'),
  (8, 'John 8', 'The Light of the World'),
  (9, 'John 9', 'Now I See'),
  (10, 'John 10', 'The Good Shepherd'),
  (11, 'John 11', 'The Resurrection and the Life'),
  (12, 'John 12', 'The Hour Has Come'),
  (13, 'John 13', 'Love One Another'),
  (14, 'John 14', 'The Way, the Truth, the Life'),
  (15, 'John 15', 'The True Vine'),
  (16, 'John 16', 'The Coming of the Spirit'),
  (17, 'John 17', 'Jesus Prays for You'),
  (18, 'John 18', 'Betrayed and Arrested'),
  (19, 'John 19', 'It Is Finished'),
  (20, 'John 20', 'He Is Risen'),
  (21, 'John 21', 'Do You Love Me?')
) AS v(n, ref, title)
WHERE p.code = 'gospel-of-john'
ON CONFLICT (plan_id, day_number) DO NOTHING;

INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, s.sort, s.kind, s.title, s.ref, s.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'gospel-of-john'
JOIN (VALUES
  (1, 'Before there was a manger, there was the Word — and He chose to move into your neighborhood, wrapping eternity in flesh. The darkness never overcame Him, and it still cannot overcome the light He shines into your life. You did not find Him first; grace made you His child, born not of blood or human will but of God.', 'What does it mean to you that God did not stay distant but came to ''dwell among us'' in person?'),
  (2, 'At a wedding running dry, Jesus turned ordinary water into the finest wine — quietly, before most guests ever noticed. He still meets the places where your resources run out, and He is unhurried, saving His best for the right moment. Bring Him your empty jars and trust Him to do what only He can.', 'Where in your life do you feel like the wine has run out, and what would it look like to hand that lack to Jesus?'),
  (3, 'Nicodemus came by night, respectable and religious, yet Jesus told him he needed to start life over from the very beginning. You cannot upgrade your way into the kingdom; you must be born anew by the Spirit. Rest here: God so loved that He gave, not to condemn you, but to rescue you.', 'What in you still tries to earn God''s approval rather than receive the new life He freely gives?'),
  (4, 'Jesus sat down tired at a well and asked a shunned, thirsty woman for a drink — then offered her water that ends all thirst. He knew everything she had done and stayed anyway, and He knows you completely and stays too. The well you keep returning to will never satisfy; He alone becomes a spring within you.', 'What ''wells'' do you keep going back to for satisfaction, and how might Jesus be offering you something deeper?'),
  (5, 'A man had lain beside healing waters for thirty-eight years, and Jesus asked him plainly whether he truly wanted to be well. Sometimes we grow comfortable in our brokenness and stop hoping for change. Hear the question for yourself today, and take up your mat — the One who heals is standing right in front of you.', 'Is there an area where you''ve stopped hoping for healing, and what would saying ''yes'' to Jesus look like there?'),
  (6, 'Five loaves and two fish in a boy''s hands became a feast for thousands, yet the crowd chased Jesus for more bread the next day. He gently redirected them to Himself as the true food that never runs out. Stop living hungry for lesser things; come to Him and you will never truly hunger again.', 'How do you tend to seek Jesus for what He can give you rather than for who He is?'),
  (7, 'On the last and greatest day of the feast, Jesus stood and shouted an invitation over the noise of the crowd: come and drink. Out of everyone who believes, He promised, rivers would flow — not a trickle, but overflow meant to reach others. Your thirst was never meant to end with you; let His life spill out through you.', 'If living water is meant to flow out of you to others, who around you is thirsty for what you''ve received?'),
  (8, 'When accusers dragged a guilty woman before Him, Jesus stooped, wrote in the dust, and left her standing in mercy instead of stones. He does not excuse your sin, but neither does He condemn you — He says ''go, and sin no more.'' Walk today in the light of the world, no longer stumbling in shame.', 'Where do you need to hear Jesus say ''neither do I condemn you,'' and how would that free you to live differently?'),
  (9, 'A man born blind couldn''t explain the theology, only the change: once I was blind, now I see. The religious experts argued while he simply worshiped the One who healed him. You don''t need every answer to follow Jesus faithfully — you only need to be honest about what He has done in you.', 'What is your own ''once I was blind, now I see'' story of what Jesus has changed in your life?'),
  (10, 'Jesus calls you by name, and His sheep know His voice above the noise of every stranger and thief. He is no hired hand who flees when danger comes — He is the Shepherd who lays down His own life for you. When fear crowds in, listen for the voice that leads you to green pastures and holds you fast.', 'How have you learned to recognize the Shepherd''s voice, and where is it hard to trust that He is leading you well?'),
  (11, 'Jesus wept at Lazarus''s tomb even though He knew resurrection was moments away — your grief matters to Him, not just the outcome. He is not merely the giver of life; He is life itself, standing in your places of death. Whatever feels four-days-buried in you, He can call it out into the light.', 'What situation in your life feels dead or beyond hope, and how does Jesus being ''the resurrection and the life'' speak into it?'),
  (12, 'Mary broke open costly perfume and poured it out on Jesus while others counted the cost, and He received her extravagance as beautiful. He was walking knowingly toward the hour of the cross, the seed that must fall and die to bear much fruit. Don''t hold back your worship or your life; poured out for Him, nothing is wasted.', 'What would it look like for you to offer Jesus something extravagant, even if others might call it wasteful?'),
  (13, 'The King of glory wrapped a towel around His waist and washed the dust from His friends'' feet, including the one who would betray Him. This is the love you are called to pass on — not admired from a distance but knelt down and given away. Let Him serve you first, then go and stoop low for someone else.', 'Whose ''feet'' is Jesus asking you to wash this week through humble, practical love?'),
  (14, 'With His own death hours away, Jesus turned to comfort His troubled friends: don''t let your hearts be troubled. He didn''t just point to the way — He is the way, the truth, and the life, and He is preparing a place for you. When the road ahead looks uncertain, remember that following Him is following the way home.', 'What is troubling your heart right now, and how does knowing Jesus is preparing a place for you change how you carry it?'),
  (15, 'You were never meant to produce fruit by striving — you were made to abide, like a branch resting in the vine. Apart from Him you can do nothing, but joined to Him your life bears fruit that lasts. Stop white-knuckling your faith today; remain in His love and let the growth come from the connection.', 'What does ''abiding'' in Jesus look like in your daily life, and where are you trying to bear fruit on your own strength?'),
  (16, 'Jesus promised that His going away was actually for your good, because the Spirit would come to be with you always. In a world that brings trouble, you are not left as an orphan to fend for yourself. Take heart — the same Jesus who overcame the world now lives with you through His Spirit.', 'How have you experienced the Holy Spirit as your helper, and where do you need His comfort or guidance right now?'),
  (17, 'On the night before the cross, Jesus prayed — and He prayed for you, for everyone who would ever believe through His disciples'' word. You were on His heart in His final hours, held before the Father with love. Live today knowing that Jesus still intercedes for you, and you are never praying alone.', 'How does it change your day to know that Jesus prayed specifically for you and still intercedes on your behalf?'),
  (18, 'In the garden Jesus stepped forward to meet His arrest so that His own could go free, laying down His life no one could take from Him. While Peter denied Him by a fire, Jesus stood calm before His accusers, in full command even as He surrendered. When betrayal and fear press in, remember He walked this road willingly, for you.', 'Where have you, like Peter, been tempted to deny or distance yourself from Jesus, and how does His steadfast love meet you there?'),
  (19, 'From the cross Jesus spoke three finished words that changed everything: it is finished. The debt you could never pay was paid in full, the work of your salvation complete — nothing left for you to add. Rest in a finished work today, and let gratitude replace every effort to prove yourself worthy.', 'What are you still trying to ''finish'' or earn that Jesus has already declared complete on the cross?'),
  (20, 'Mary stood weeping at an empty tomb until the risen Jesus spoke her name — and everything changed. He meets you in your grief and calls you personally out of despair into resurrection hope. Like Thomas, you may carry doubts, but the same Jesus invites you to move from unbelief to worship: my Lord and my God.', 'Where do you need the risen Jesus to call your name and turn your grief or doubt into hope?'),
  (21, 'After Peter''s failure, Jesus didn''t shame him — He made him breakfast and asked three times, ''do you love me?'' Grace restores what guilt would have discarded, and your love, not your track record, is what He calls forward. However you''ve failed, He still says ''follow me'' and entrusts you with His work again.', 'How is Jesus meeting you with restoration rather than shame, and what is He calling you to ''feed'' or tend in response to His love?')
) AS v(n, devo, prompt) ON v.n = d.day_number
JOIN LATERAL (VALUES
  (0, 'scripture',  'Today''s Reading', d.reference, '_' || d.reference || '_ — read slowly, and ask the Lord to speak.'),
  (1, 'devotional', 'Devotional',       NULL::varchar, v.devo),
  (2, 'talk',       'Talk it Over',     NULL::varchar, v.prompt)
) AS s(sort, kind, title, ref, content) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM reading_plan_day_segments x WHERE x.plan_day_id = d.plan_day_id
);

-- ======================================================================
-- sermon-on-the-mount  (10 days)
UPDATE reading_plans SET day_count = 10 WHERE code = 'sermon-on-the-mount';

INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title
FROM reading_plans p
CROSS JOIN (VALUES
  (1, 'Matthew 5:1-12', 'The Beatitudes'),
  (2, 'Matthew 5:13-16', 'Salt and Light'),
  (3, 'Matthew 5:17-20', 'Fulfilling the Law'),
  (4, 'Matthew 5:21-26', 'Anger and Reconciliation'),
  (5, 'Matthew 5:27-37', 'Purity and Integrity'),
  (6, 'Matthew 5:38-48', 'Love Your Enemies'),
  (7, 'Matthew 6:1-18', 'Giving, Prayer, and Fasting'),
  (8, 'Matthew 6:19-34', 'Treasure and Worry'),
  (9, 'Matthew 7:1-12', 'Judging and Asking'),
  (10, 'Matthew 7:13-29', 'Two Roads, Two Foundations')
) AS v(n, ref, title)
WHERE p.code = 'sermon-on-the-mount'
ON CONFLICT (plan_id, day_number) DO NOTHING;

INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, s.sort, s.kind, s.title, s.ref, s.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'sermon-on-the-mount'
JOIN (VALUES
  (1, 'Notice who Jesus calls blessed: the poor in spirit, the mourning, the meek — not the winners the world crowns. If today you feel more empty than accomplished, hear Him name that very place as the doorway to God''s kingdom. Your lack is not your disqualification; in His economy it is exactly where grace begins.', 'Which of the Beatitudes describes where you actually are right now, and what would it mean to trust Jesus''s blessing over that place?'),
  (2, 'Salt and light don''t exist for themselves — they work only when they touch something else. Jesus assumes your faith will be tasted and seen in the ordinary places you already stand: your desk, your street, your group chat. Don''t hide the flavor or dim the glow; let people meet God in how you actually live.', 'Where has God already placed you that could taste or see something of Jesus through the way you show up this week?'),
  (3, 'Jesus didn''t come to erase God''s commands but to fill them full — to reveal all they were always pointing toward. That means Scripture isn''t an obstacle to grace but a gift meant to shape you. Instead of asking how little the Law requires, let Christ show you the abundant life it was always describing.', 'Is there a part of God''s Word you''ve been treating as a hurdle rather than a gift, and how might Jesus be inviting you to see it differently?'),
  (4, 'Jesus traces murder back to the anger that feeds it, and He won''t let you settle for merely keeping your hands clean. The contempt you nurse, the grudge you rehearse — He calls you to deal with it, even to leave your gift at the altar and go make peace first. Reconciliation isn''t optional extra credit; to Him it''s worship.', 'Is there someone you need to go to and make peace with before you bring your next offering to God?'),
  (5, 'Jesus guards the heart behind the eyes and the word behind the vow, because integrity isn''t a public performance — it''s who you are when no one checks. He asks for a wholeness where your desires, your promises, and your actions all tell the same true story. Let your yes simply mean yes, and let purity begin in the private places first.', 'Where is there a gap between the person you present and the person you actually are, and what would closing it look like?'),
  (6, 'Loving those who love you is easy math; Jesus asks for the kind of love that blesses an enemy and prays for a persecutor. This isn''t weakness — it''s the family resemblance of a Father who sends sun and rain on the ungrateful and the good alike. Refuse to let someone else''s hostility set the terms of your heart.', 'Who is the person it feels most unreasonable to love right now, and what would praying for them actually cost you?'),
  (7, 'Jesus exposes the quiet temptation to perform our religion for an audience — to give, pray, and fast for the applause. He invites you instead into the secret place, where your Father sees what no one else does and that is enough. When God''s attention becomes your reward, you''re finally free from needing everyone else''s.', 'Which of your spiritual practices are you most tempted to do for others to notice, and how might doing it in secret change your heart?'),
  (8, 'Your heart follows your treasure, so Jesus asks where you''re really storing it — and whether worry has quietly become your evidence that God can''t be trusted. Look at the birds He feeds and the lilies He clothes: you are worth far more to your Father than these. Seek His kingdom first, and watch anxiety loosen its grip one day at a time.', 'What worry are you carrying that a deeper trust in your Father''s care might actually set down?'),
  (9, 'Jesus warns against the harsh eye that spots a speck in someone else while ignoring the plank in your own — then points you toward a Father who loves to give good gifts to those who ask. Trade your role as judge for the posture of a child who keeps knocking. The same mercy you long to receive is the mercy you''re called to extend.', 'Where have you been quicker to judge than to ask God for help, and what would it look like to reverse that this week?'),
  (10, 'Two roads, two trees, two builders — Jesus ends His sermon by refusing to let you stay neutral. The difference isn''t hearing His words but doing them, so that when the storm hits, your house stands on rock. Don''t just admire His teaching; build your life on it, because the foundation you lay in the calm is the one that holds in the flood.', 'Which of Jesus''s words from this sermon is He asking you to move from hearing into doing, starting now?')
) AS v(n, devo, prompt) ON v.n = d.day_number
JOIN LATERAL (VALUES
  (0, 'scripture',  'Today''s Reading', d.reference, '_' || d.reference || '_ — read slowly, and ask the Lord to speak.'),
  (1, 'devotional', 'Devotional',       NULL::varchar, v.devo),
  (2, 'talk',       'Talk it Over',     NULL::varchar, v.prompt)
) AS s(sort, kind, title, ref, content) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM reading_plan_day_segments x WHERE x.plan_day_id = d.plan_day_id
);

-- ======================================================================
-- psalms-of-comfort  (30 days)
UPDATE reading_plans SET day_count = 30 WHERE code = 'psalms-of-comfort';

INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title
FROM reading_plans p
CROSS JOIN (VALUES
  (1, 'Psalm 23', 'The Lord My Shepherd'),
  (2, 'Psalm 27', 'The Lord My Light'),
  (3, 'Psalm 34', 'Near to the Brokenhearted'),
  (4, 'Psalm 42', 'Thirsting for God'),
  (5, 'Psalm 46', 'A Very Present Help'),
  (6, 'Psalm 55', 'Cast Your Burden'),
  (7, 'Psalm 61', 'The Rock That Is Higher'),
  (8, 'Psalm 62', 'My Soul Waits in Silence'),
  (9, 'Psalm 63', 'My Soul Thirsts for You'),
  (10, 'Psalm 71', 'My Hope from Youth'),
  (11, 'Psalm 73', 'When Envy Fades'),
  (12, 'Psalm 77', 'I Will Remember'),
  (13, 'Psalm 84', 'Better Is One Day'),
  (14, 'Psalm 86', 'Teach Me Your Way'),
  (15, 'Psalm 90', 'Our Dwelling Place'),
  (16, 'Psalm 91', 'Under His Wings'),
  (17, 'Psalm 94', 'When Anxiety Is Great'),
  (18, 'Psalm 103', 'Bless the Lord, O My Soul'),
  (19, 'Psalm 107', 'He Stilled the Storm'),
  (20, 'Psalm 116', 'He Heard My Voice'),
  (21, 'Psalm 118', 'His Love Endures Forever'),
  (22, 'Psalm 121', 'My Help Comes from the Lord'),
  (23, 'Psalm 126', 'Sowing in Tears'),
  (24, 'Psalm 130', 'Out of the Depths'),
  (25, 'Psalm 138', 'He Fulfills His Purpose'),
  (26, 'Psalm 139', 'Fully Known, Fully Loved'),
  (27, 'Psalm 142', 'When My Spirit Faints'),
  (28, 'Psalm 143', 'Teach Me to Do Your Will'),
  (29, 'Psalm 145', 'The Lord Is Near'),
  (30, 'Psalm 147', 'He Heals the Brokenhearted')
) AS v(n, ref, title)
WHERE p.code = 'psalms-of-comfort'
ON CONFLICT (plan_id, day_number) DO NOTHING;

INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, s.sort, s.kind, s.title, s.ref, s.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'psalms-of-comfort'
JOIN (VALUES
  (1, 'A shepherd''s rod and staff are not for show — they guide and protect. Even in the valley of the shadow, you are led, not abandoned, to still waters and a table set in the presence of your fears. Goodness and mercy are already following you home.', 'Where do you most need to trust the Shepherd to lead you right now?'),
  (2, 'When enemies close in, David steadies himself with one longing: to gaze on the Lord''s beauty in His house. If God is your light, the darkness has no final word over you; if He is your stronghold, fear loses its grip. Wait for Him, and let your heart take courage.', 'What one thing are you asking to ''seek'' from God in this season?'),
  (3, 'The Lord is not distant from your pain — He draws close precisely when your heart is crushed and your spirit broken. Taste and see that even here His goodness holds. Those who look to Him are radiant, and no cry from the lowly goes unheard.', 'How have you sensed God drawing near to you in a broken moment?'),
  (4, 'Like a deer panting for flowing streams, your thirst itself is a kind of prayer. Even when your tears have been your food and your soul is downcast, you can preach hope to yourself: ''I will yet praise Him.'' By day His love, by night His song, still steady you.', 'What would it look like to gently speak hope to your own downcast soul today?'),
  (5, 'Though the earth gives way and mountains fall into the sea, there is a river whose streams make glad the city of God. You do not have to hold everything together — He is your refuge and strength. Be still, and let Him be God; He is with you, and He is enough.', 'What are you trying to hold together that you could hand back to God this week?'),
  (6, 'The weight you are carrying was never meant to stay on your shoulders. Cast your burden on the Lord, and He will sustain you — He will not let the righteous be shaken. Even when a friend has wounded you, God hears your morning, noon, and evening cry.', 'What specific burden do you need to cast onto the Lord today?'),
  (7, 'When your heart grows faint at the ends of the earth, there is a Rock higher than you can climb on your own. He has been your shelter, a strong tower against every storm. Long to dwell in His tent forever, and rest under the shelter of His wings.', 'Where do you need God to be the ''rock higher than you'' this week?'),
  (8, 'There is a quiet strength in waiting — your soul finds rest in God alone, not in the noise of your worries. He is your rock, your salvation, your fortress; you will not be greatly shaken. Pour out your heart to Him, for He is a refuge that never fails.', 'What does it look like for you to wait on God in silence rather than striving?'),
  (9, 'In a dry and weary land where there is no water, your soul can still thirst for the One who satisfies. His steadfast love is better than life itself, and in the watches of the night you can remember He has been your help. Your soul clings to Him, and His right hand holds you fast.', 'When has remembering God''s past help carried you through a sleepless night?'),
  (10, 'From your mother''s womb until now, God has been your hope, and He will not cast you off when your strength is spent. Even into old age and gray hairs, He carries what He has always carried. Your story of His faithfulness is not finished — you will still declare His wondrous deeds.', 'What part of God''s lifelong faithfulness to you do you most want to remember today?'),
  (11, 'When the prosperity of others makes your own path feel unfair, the sanctuary changes everything you see. God holds your right hand and guides you with His counsel, and you learn He is enough. Earthly things fade, but you can say: whom have I in heaven but You?', 'What comparison is stealing your peace, and how might God''s nearness reframe it?'),
  (12, 'When you cannot sleep and your spirit faints, it is enough to simply remember — the deeds of the Lord, His wonders of old. Recalling His mighty acts does not erase the question, but it steadies the questioner. His way was through the sea, and He still leads His people like a flock.', 'What past work of God will you deliberately call to mind when doubt returns?'),
  (13, 'A single day in His courts is better than a thousand elsewhere — the sparrow finds a home near His altar, and so do you. Even in the valley of weeping, you can make it a place of springs, going from strength to strength. Blessed are those whose hearts are set on the way to Him.', 'What ''valley of weeping'' are you walking through, and where might a spring appear?'),
  (14, 'You are poor and needy, and that is exactly the kind of heart God bends down to hear. Ask Him to teach you His way and give you an undivided heart to walk in His truth. He is abounding in steadfast love, ready to answer in the day of your trouble.', 'What would an ''undivided heart'' toward God change in your day today?'),
  (15, 'Before the mountains were born, from everlasting to everlasting, the Lord has been your dwelling place. Your days are brief, but they are held in the One who is not. Ask Him to teach you to number your days, and to satisfy your mornings with His unfailing love.', 'How might numbering your days lead you to a wiser, more grateful heart?'),
  (16, 'Under the shadow of the Almighty you find a shelter that terror cannot break, a refuge beneath His wings. He commands His angels concerning you, to guard you in all your ways. Because you hold fast to Him in love, He answers when you call and is with you in trouble.', 'In what area of fear do you most need to trust that God is your refuge?'),
  (17, 'When anxiety is great within you, His consolations bring joy to your soul. The Lord will not forsake His people or abandon you to the flood of the wicked. He has become your fortress and the rock of your refuge, steadying your foot when it slips.', 'When your anxious thoughts multiply, what consolation of God quiets you?'),
  (18, 'Bless the Lord and forget not His benefits — He forgives, heals, and crowns you with steadfast love and mercy. As high as the heavens are above the earth, so great is His love for those who fear Him. He knows your frame, remembers you are dust, and is compassionate as a father.', 'Which of God''s benefits is easiest for you to forget, and how can you recall it?'),
  (19, 'Some wandered in desert wastes, some sat in darkness, some were tossed on stormy seas — and to each who cried out, He answered. He can hush the wind to a whisper and still the waves you thought would drown you. Let the redeemed say so: give thanks, for His steadfast love endures.', 'What storm has God stilled in your life that you can give thanks for today?'),
  (20, 'Because the Lord inclined His ear to you, you can love Him all your days. When the cords of death entangled you and anguish found you, you called on His name, and He heard your voice. What can you give back? Lift the cup of salvation and walk before Him in the land of the living.', 'How has God heard your voice in a moment when you felt overwhelmed?'),
  (21, 'Out of your distress you called, and the Lord answered by setting you in a broad place. It is better to take refuge in Him than to trust in anything that fails. The stone the builders rejected became the cornerstone — this is the Lord''s doing, and His love endures forever.', 'Where has God set you in a ''broad place'' after a season of distress?'),
  (22, 'Lift your eyes to the hills and remember your help comes from the Maker of heaven and earth. He will not let your foot slip; the One who keeps you neither slumbers nor sleeps. He is your shade at your right hand, keeping your coming and going both now and forever.', 'As you ''come and go'' this week, where do you need to remember God is keeping you?'),
  (23, 'Those who sow in tears will reap with songs of joy — the weeping is not wasted seed. You may go out carrying the seed to sow, weeping as you go, but there is a harvest coming home. What God has done before, He can do again; restore our fortunes, O Lord.', 'What are you sowing in tears right now that you''re trusting God to bring to harvest?'),
  (24, 'From the depths you cry, and the good news is that God does not keep a record of sins to hold against you — with Him there is forgiveness. So your soul waits, more than watchmen wait for the morning. Hope in the Lord, for with Him is steadfast love and full redemption.', 'What ''depths'' are you crying out from, and what would waiting hopefully look like?'),
  (25, 'When you walk in the midst of trouble, He preserves your life, and His right hand saves you. The Lord will fulfill His purpose for you — He does not abandon the work of His hands. Though you feel small and unfinished, His steadfast love endures forever over your life.', 'Where do you need to trust that God will fulfill His purpose in your unfinished story?'),
  (26, 'Before a word is on your tongue, He knows it completely — you are searched, known, and still held. There is nowhere you can flee from His presence; even in darkness the night shines like day to Him. You were fearfully and wonderfully made, and fully known, you are fully loved.', 'How does it comfort you that God knows you completely and loves you still?'),
  (27, 'When your spirit faints within you, He knows the way you should go, even when you cannot see it. You may feel that no one cares for your soul, but He is your refuge and your portion in the land of the living. Cry out, and trust that He will deal bountifully with you.', 'When your spirit feels faint, who or what helps you remember God knows your way?'),
  (28, 'When your spirit grows faint and the enemy pursues, you can stretch out your hands to Him like thirsty ground. Ask Him to teach you to do His will and let His good Spirit lead you on level ground. In the morning, let His steadfast love be the first word you hear.', 'What would it mean to hear of God''s steadfast love first thing each morning?'),
  (29, 'The Lord is near to all who call on Him, near to all who call in truth. He upholds all who are falling and raises up all who are bowed down; He is gracious and slow to anger. He opens His hand and satisfies the desire of every living thing — including yours.', 'In what way do you need to know that the Lord is near to you today?'),
  (30, 'He counts the stars and calls each one by name — and the same God binds up your wounds. He heals the brokenhearted and gently gathers what has been scattered. His understanding has no limit, and His delight is not in the strong but in those who hope in His steadfast love.', 'What broken place are you inviting God to bind up and heal in you?')
) AS v(n, devo, prompt) ON v.n = d.day_number
JOIN LATERAL (VALUES
  (0, 'scripture',  'Today''s Reading', d.reference, '_' || d.reference || '_ — read slowly, and ask the Lord to speak.'),
  (1, 'devotional', 'Devotional',       NULL::varchar, v.devo),
  (2, 'talk',       'Talk it Over',     NULL::varchar, v.prompt)
) AS s(sort, kind, title, ref, content) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM reading_plan_day_segments x WHERE x.plan_day_id = d.plan_day_id
);

-- Down Migration
-- (Non-reversible content seed — leaving days/segments in place is the safe no-op.)
SELECT 1;
