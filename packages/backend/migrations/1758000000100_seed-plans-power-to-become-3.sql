-- Seed 7 standalone study plans from 'The Power to Become' (Moses Mwicigi):
-- First Steps (7d) + six 10-day plans. Each day: key verse (scripture) ->
-- Devotional -> Talk it Over (Reflect) -> Pray (+blessing) -> Go Deeper.
-- No videos: the video segment row is simply absent. Re-runnable: plans
-- upsert by code and days are cleanly reseeded.

-- Up Migration

-- ====================================================================
-- believe-again (15 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('believe-again', 'Believe Again', 'Fifteen days to rebuild your belief system', 'Underneath every life there is a hidden foundation: a set of beliefs — about God, about yourself, about what is possible — poured quietly over the years by voices, wounds and experiences. Everything you attempt, and everything you never dare to attempt, stands on that foundation. What you believe, you build with. Some of us are building a large calling on a cracked foundation. The gifts are real, the vision is real — but underneath sits an old slab of quiet unbelief: God loves others more. I always spoil things. It is too late for me. For fifteen days we will excavate, repour and build. And we begin where all true believing begins — with a Christ who is astonishingly kind to strugglers: the man who cried “I do believe; help me overcome my unbelief!” went home with a miracle.', 'Faith', 15, 17, 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'believe-again');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Mark 9:23–24', 'The Kindest Word Ever Spoken to a Doubter'),
  (2, 'James 2:26, 18', 'What You Believe, You Build With'),
  (3, 'Colossians 2:8', 'Where Your Beliefs Came From'),
  (4, '1 John 4:16', 'The First Stone: God Loves Me'),
  (5, 'Isaiah 40:8', 'Feelings Are Weather; the Word Is Climate'),
  (6, 'Romans 10:17', 'Faith Comes by Hearing — So Feed It'),
  (7, 'Hebrews 11:6', 'The Faith That Pleases Him'),
  (8, '2 Corinthians 4:13', 'Believing Has a Voice'),
  (9, 'James 2:18', 'Believing Has Feet'),
  (10, 'Psalm 139:14', 'Believe Well About Your Body'),
  (11, 'Galatians 6:4', 'Compare Only With Yourself'),
  (12, 'Romans 8:16', 'The Spirit Who Confirms'),
  (13, 'John 20:27', 'Doubt Is a Door, Not a Wall'),
  (14, 'Ephesians 3:20', 'Sign Your Declaration'),
  (15, 'Jude 20–21', 'A Foundation That Carries Weight')
) AS v(n, ref, title) WHERE p.code = 'believe-again';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'believe-again'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Mark 9:23–24', '“If you can”? said Jesus. “Everything is possible for one who believes.” Immediately the boy’s father exclaimed, “I do believe; help me overcome my unbelief!”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'A desperate father brought Jesus a suffering son and a wounded faith: “If you can do anything…” Years of disappointment were packed into that little word “if.” Jesus caught it instantly — and instead of turning away, He opened a door the size of heaven: everything is possible for one who believes. Then came the most honest prayer in the Bible: I do believe; help my unbelief. And here is the glory — Jesus answered it. He did not demand finished faith; He worked with a faith under construction. That is the Christ you are rebuilding with. Bring Him your mixture of belief and doubt exactly as it is. This plan is not a test to pass; it is a construction site He has already agreed to supervise.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What is packed inside your "if" — which disappointments taught you to say it?

— Pray the father''s prayer over one specific area today.'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, I do believe — help my unbelief. Take my faith as it is, under construction, and build it with Your own hands. Amen.

_May the Christ who works with unfinished faith begin His finest work in yours._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Mark 9:14–29'),
  (2, 1, 'scripture', 'Today''s Reading', 'James 2:26, 18', '“As the body without the spirit is dead, so faith without deeds is dead… I will show you my faith by my deeds.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Watch any life closely and you can read its beliefs — not the stated ones, the operating ones. A man who believes opportunity is scarce hoards; a woman who believes she is unlovable withdraws before she can be left; a believer who believes God is stingy prays small prayers. What you believe, you create — because belief is the raw material of behavior, and behavior, repeated, becomes a life. Jesus said it plainly: “According to your faith let it be done to you” (Matthew 9:29). So begin the excavation: for each area of struggle, ask not “what am I doing wrong?” but “what must I be believing, for this behavior to make sense?” Write the answers down without shame. You cannot repour a foundation you have never inspected — and inspection is where the miracle of these fifteen days begins.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Pick one struggling area: what belief would make its patterns "make sense"?

— What does your prayer size reveal about your operating picture of God?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, give me the courage of inspection. Show me the operating beliefs beneath my behaviors — and let the digging begin without shame, under grace. Amen.

_May the inspection be gentle and the rebuilding be glorious._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Matthew 9:27–30; Proverbs 23:7'),
  (3, 1, 'scripture', 'Today''s Reading', 'Colossians 2:8', '“See to it that no one takes you captive through hollow and deceptive philosophy, which depends on human tradition… rather than on Christ.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Nobody chooses their first beliefs. They were poured into you before you could evaluate them — by repeated words in childhood, by wounds that preached louder than sermons, by a culture''s assumptions, by the atmosphere of your home. A teacher''s careless sentence can govern a person for forty years. This realization is liberating, not condemning: many things you have called “just how I am” are actually “just what I was told.” And what was installed by words and wounds can be uninstalled by truth and healing. So today, trace two or three governing beliefs to their sources. Whose voice originally said it? Was that voice speaking truth — or pain? Honor what deserves honor, and mark for demolition whatever contradicts what Christ says. From now on, your beliefs must show a passport at the border: only what agrees with Him gets residence.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Trace your loudest limiting belief: whose voice installed it, and when?

— Was that voice speaking truth about you — or pain from their own story?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, sort the voices in my foundation. Keep what was true, heal what was wounded, and give residence only to what agrees with Christ. Amen.

_May every borrowed lie in your foundation lose its residence permit this week._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Colossians 2:6–10; Psalm 51:6'),
  (4, 1, 'scripture', 'Today''s Reading', '1 John 4:16', '“And so we know and rely on the love God has for us. God is love. Whoever lives in love lives in God, and God in them.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Every belief system needs a first stone, and here is yours: God loves me. Not generally — the whole world, averaged out — but specifically, presently, warmly. John, who leaned on Jesus'' chest, chose two verbs for it: we know and rely on the love God has for us. Not just acknowledge — rely on. Put weight on it, like a bridge. Most cracked foundations crack here first. We believe God tolerates us, monitors us, is disappointed in us — and every other belief warps to match. But the cross is God''s once-for-all argument: “God demonstrates his own love for us in this: While we were still sinners, Christ died for us” (Romans 5:8). Lay this stone deliberately today. Say it aloud, in first person, until your ears believe your mouth: God loves me. I rely on it. Everything else we build will stand on this.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Which counterfeit have you believed — tolerated, monitored, or loved?

— What would you attempt if you truly relied on His love like a bridge?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, I lay the first stone: You love me. Not averaged, not reluctant — demonstrated at the cross. Today I do not just admit it; I rely on it. Amen.

_May the first stone settle so deep that every storm after this finds it immovable._'),
  (4, 5, 'reading', 'Go Deeper', NULL, '1 John 4:9–19; Romans 5:6–8'),
  (5, 1, 'scripture', 'Today''s Reading', 'Isaiah 40:8', '“The grass withers and the flowers fall, but the word of our God endures forever.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Here is a decision that will change your spiritual life permanently: decide what gets the casting vote — your feelings or God''s Word. Feelings are weather: real, vivid, and gone by Thursday. The Word is climate: it endures forever. Many believers live emotionally seasick because they re-vote their beliefs every morning based on how they woke up. Feeling condemned? Then I must be condemned. Feeling abandoned? Then God must be far. But feelings are witnesses, not judges — they report your state, they do not rule on truth. Train the new reflex: when feeling and Scripture disagree, say — kindly, firmly — “I hear you, feeling. But it is written…” That was Jesus'' own sword in the wilderness, three times: it is written. Your emotions will not vanish; they will slowly resign as rulers and take their proper seat as servants.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Which feeling most often out-votes the Word in your life?

— Find the "it is written" that answers it — memorize it today.'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, I move the casting vote. Feelings may speak, but Your Word rules. Teach me Jesus'' reflex: it is written, it is written, it is written. Amen.

_May your inner climate grow so settled that no weather can rearrange it._'),
  (5, 5, 'reading', 'Go Deeper', NULL, 'Isaiah 40:6–8; Matthew 4:1–11'),
  (6, 1, 'scripture', 'Today''s Reading', 'Romans 10:17', '“Consequently, faith comes from hearing the message, and the message is heard through the word about Christ.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Faith is not a talent some are born with; it is an appetite everyone can feed. Scripture tells you its diet precisely: faith comes by hearing — present, continuous — the word about Christ. Not by having heard, years ago. By hearing, today. This explains the seasons your believing grew thin: check them, and you will usually find the hearing had grown thin first. Belief systems, like bodies, weaken on poor diets — and no one else can eat for you. So build the feeding schedule: Scripture aloud daily (your own voice counts as hearing), anointed preaching through the week, testimonies rehearsed at your table, worship filling your house. Fill the ears and the heart follows; fill the heart, and believing stops being effort and becomes overflow.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Audit your ears: what have they been fed this month, and what has it grown?

— Design your faith diet: what will you hear daily, weekly?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, I take responsibility for my faith''s diet. Fill my ears with the word about Christ until believing becomes the overflow of hearing. Amen.

_May your ears eat well this week — and your faith show the feeding._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Romans 10:14–17; Joshua 1:8'),
  (7, 1, 'scripture', 'Today''s Reading', 'Hebrews 11:6', '“And without faith it is impossible to please God, because anyone who comes to him must believe that he exists and that he rewards those who earnestly seek him.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Faith is the role player in all becoming — the hand that receives what grace provides. And today''s verse tells us why heaven prizes it: faith honors God''s character. It believes two things about Him — that He is, and that He rewards seekers. Unbelief, at its root, is an insult dressed as humility: it quietly testifies that God is either absent or stingy. Read Hebrews 11''s honor roll and notice what it celebrates: not perfect people, but people who took God at His word and moved — Noah building, Abraham leaving, Sarah conceiving, Moses choosing. Your believing matters more than you know. Every act of trust — praying again, sowing again, hoping again — pleases the heart of God like few things in the universe. Today, do one thing purely because you believe He rewards those who seek Him.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Where has "humility" been hiding unbelief in your life?

— What one act of trust will you perform today, purely to please Him?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, I want to please You — so I choose to believe: You are, and You reward seekers. Receive my small acts of trust as the worship they are. Amen.

_May heaven smile today over your smallest act of trust._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Hebrews 11:1–6; John 20:29'),
  (8, 1, 'scripture', 'Today''s Reading', '2 Corinthians 4:13', '“It is written: “I believed; therefore I have spoken.” Since we have that same spirit of faith, we also believe and therefore speak.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Belief that never reaches the mouth remains a private opinion; belief spoken becomes a governing force. The spirit of faith has a grammar: I believed; therefore I have spoken. Abraham was renamed aloud. David answered Goliath aloud. Jesus commanded storms aloud. Speaking does something to the believer as much as to the situation: your own ears are your most faithful congregation, and they attend every sermon your mouth preaches. Speak doubt and you disciple yourself downward; speak the Word and you disciple yourself into your own becoming. So give your rebuilt beliefs a daily voice. Take the stones you have laid — God loves me; His Word out-votes my feelings; He rewards my seeking — and read them aloud each morning. A belief system with a voice becomes a belief system with a spine.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— What has your most faithful congregation — your own ears — been hearing from you?

— Write your morning declarations from this plan''s stones. Begin tomorrow.'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, give my believing a voice. I will speak what I believe until what I believe shapes what I see. I believed; therefore I speak. Amen.

_May your mouth become your faith''s best friend from today._'),
  (8, 5, 'reading', 'Go Deeper', NULL, '2 Corinthians 4:13–18; Romans 10:9–10'),
  (9, 1, 'scripture', 'Today''s Reading', 'James 2:18', '“But someone will say, “You have faith; I have deeds.” Show me your faith without deeds, and I will show you my faith by my deeds.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'After voice comes feet. Belief is proven at the point of action: Peter''s faith was measured not by his opinion of water-walking but by his leg over the side of the boat. “Faith by itself, if it is not accompanied by action, is dead” (James 2:17). Notice how Scripture''s miracles ride on obedient movement: lepers cleansed as they went; Jordan parted when priests'' feet entered the water; the man''s withered hand restored as he stretched it out. Heaven loves to meet motion. So convert one rebuilt belief into one scheduled action this week. Believe He provides? Sow something. Believe He calls you? Volunteer somewhere. Believe He forgives? Have the reconciliation conversation. Do not wait to feel bold; act at the size of your current faith, and watch faith grow at the pace of your feet.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Which belief from this plan is still waiting for feet?

— Schedule it: what action, what day, this week?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Lord, my faith requests walking papers. Show me this week''s one obedience, and I will move — lepers were healed as they went, and so will I be. Amen.

_May your feet catch up with your faith — and your miracles meet you mid-stride._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'James 2:14–26; Luke 17:11–14'),
  (10, 1, 'scripture', 'Today''s Reading', 'Psalm 139:14', '“I praise you because I am fearfully and wonderfully made; your works are wonderful, I know that full well.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Your belief system includes a file marked “my body” — and for many, that file is full of complaints. We stand before mirrors like critics before an exhibit, itemizing what we would return to the Maker. But hear David''s settled verdict: fearfully and wonderfully made — and he knew it full well. Remember the deep truth from the book of your becoming: “a body you prepared for me” (Hebrews 10:5). Your frame was custom-built for your specific assignment — the height, the face, the complexion, the wiring. Industries profit from your dissatisfaction; whole economies are funded by people convinced they are mistakes needing correction. Refuse the propaganda. Steward your body — feed it well, rest it, keep it strong — but never despise it. You cannot become your best while at war with the vessel that carries you. Appreciate what was prepared for you.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— What is written in your "my body" file — complaint or praise?

— Thank God specifically for three features you have criticized.'),
  (10, 4, 'devotional', 'Pray', NULL, 'Maker of my frame, I close the complaints file and open the praise file: I am fearfully and wonderfully made — and my body was prepared for my assignment. I receive it with thanks. Amen.

_May you and the body that carries you finally sign a peace treaty — witnessed by its Maker._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Psalm 139:13–16; 1 Corinthians 6:19–20'),
  (11, 1, 'scripture', 'Today''s Reading', 'Galatians 6:4', '“Each one should test their own actions. Then they can take pride in themselves alone, without comparing themselves to someone else.”'),
  (11, 2, 'devotional', 'Devotional', NULL, 'Comparison is the termite of belief systems — it hollows out confidence quietly, from the inside. Paul names the folly: those who “measure themselves by themselves and compare themselves with themselves are not wise” (2 Corinthians 10:12). The instrument itself is broken. You don''t compare your success with the people around you; you measure your progress against your own God-given potential and assignment. You can be ahead of everyone nearby and still below your own book — failure wearing a garland. Or behind everyone nearby and exactly on course in your book — success wearing rags. When Peter compared his road to John''s, Jesus ended the audit in seven words: “What is that to you? You must follow me” (John 21:22). Run in your lane — the race “marked out for us” (Hebrews 12:1). The lanes were drawn by a Father who has no second-favorite children.'),
  (11, 3, 'talk', 'Talk it Over', NULL, '— Whose lane have you been running your race against?

— Measured against your own book — not their lane — how are you actually doing?'),
  (11, 4, 'devotional', 'Pray', NULL, 'Father, I withdraw from every race You never entered me in. One lane, one book, one Judge. I will test my own work and run marked-out ground with joy. Amen.

_May your eyes stay so fixed on your own lane that comparison starves for attention._'),
  (11, 5, 'reading', 'Go Deeper', NULL, 'Galatians 6:1–5; John 21:18–22'),
  (12, 1, 'scripture', 'Today''s Reading', 'Romans 8:16', '“The Spirit himself testifies with our spirit that we are God’s children.”'),
  (12, 2, 'devotional', 'Devotional', NULL, 'A rebuilt belief system needs more than arguments; it needs a Witness — and God has placed one inside you. The Holy Spirit testifies with your spirit: a deep, quiet confirmation, beneath moods, that you are God''s child. This is the role of the Holy Spirit in becoming: He takes what is objectively true and makes it inwardly unshakable. He reminds you of the Word when lies come recruiting (John 14:26); He pours God''s love into your heart (Romans 5:5); He is the deposit guaranteeing everything promised (Ephesians 1:13–14). So involve Him by name in this reconstruction. When old beliefs whisper at midnight, do not argue alone — ask: Spirit of God, testify. Tell me again whose I am. He has never once declined that prayer. A belief confirmed by the Witness within cannot be talked out of you from without.'),
  (12, 3, 'talk', 'Talk it Over', NULL, '— Have you been arguing with lies alone, or calling the Witness?

— Where do you most need His inner "testimony" this week?'),
  (12, 4, 'devotional', 'Pray', NULL, 'Holy Spirit, Witness within, testify to my spirit — of the Father''s love, my sonship, my book in heaven. Make the truth unshakable where arguments cannot reach. Amen.

_May the Witness within you speak louder than every accusation without._'),
  (12, 5, 'reading', 'Go Deeper', NULL, 'Romans 8:14–17; John 14:25–27'),
  (13, 1, 'scripture', 'Today''s Reading', 'John 20:27', '“Then he said to Thomas, “Put your finger here; see my hands… Stop doubting and believe.”'),
  (13, 2, 'devotional', 'Devotional', NULL, 'Thomas missed one meeting and declared his terms: unless I touch the wounds, I will not believe. For a week, heaven let him sit with his doubt — then Jesus walked through a locked door and offered him exactly what he had asked for: put your finger here. Mark the kindness: no lecture, no shaming, no demotion from the twelve. The risen Christ made a personal appointment with one doubter''s specific conditions — and out of that encounter came the highest confession in the gospels: “My Lord and my God!” Doubt handled honestly is a door: bring it to Jesus, state it plainly, stay in the room with the disciples while you wait. Doubt handled dishonestly — nursed in isolation, worn as sophistication — hardens into a wall. Yours can be a Thomas story: a week of questions, then a lifetime of unshakable confession.'),
  (13, 3, 'talk', 'Talk it Over', NULL, '— What are your honest "unless" conditions? Have you told Jesus, plainly?

— What keeps you "in the room" while you wait — and are you staying there?'),
  (13, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, here are my doubts, stated plainly. I stay in the room. Come through my locked doors, and turn my questions into "My Lord and my God!" Amen.

_May your honest doubts receive personal appointments with the risen Christ._'),
  (13, 5, 'reading', 'Go Deeper', NULL, 'John 20:24–29'),
  (14, 1, 'scripture', 'Today''s Reading', 'Ephesians 3:20', '“Now to him who is able to do immeasurably more than all we ask or imagine, according to his power that is at work within us…”'),
  (14, 2, 'devotional', 'Devotional', NULL, 'There is a moment in every rebuilding when inspection ends and occupancy begins. Today is that moment: put your rebuilt belief system in writing, over your own name. My Declaration of Becoming: I declare that I am not an accident — I was chosen before the foundation of the world, and my days are written in God''s book. I declare that God loves me, and I rely on it. His Word out-votes my feelings. He rewards my seeking. My body was prepared for my assignment. I run in my own lane. The Witness within me confirms whose I am. I will speak these things, act on these things, and contend for everything written about me — until I become everything God created me to be. Sign it. Date it. Post it where your mornings will find it. Documents outlast moods — and this one has heaven''s countersignature.'),
  (14, 3, 'talk', 'Talk it Over', NULL, '— Which line of the declaration costs you most to sign — and why?

— Where will you post it so your mornings meet it?'),
  (14, 4, 'devotional', 'Pray', NULL, 'Father, I sign — not because my faith is finished, but because Yours never fails. Countersign my declaration with Your Spirit, and hold me to it kindly all my days. Amen.

_May the document you sign today still be governing your descendants'' courage._'),
  (14, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 3:14–21; Habakkuk 2:2'),
  (15, 1, 'scripture', 'Today''s Reading', 'Jude 20–21', '“But you, dear friends, by building yourselves up in your most holy faith and praying in the Holy Spirit, keep yourselves in God’s love…”'),
  (15, 2, 'devotional', 'Devotional', NULL, 'Fifteen days ago you inherited a foundation; today you own one. But hear the commissioning in Jude''s verbs: building — present continuous. Belief systems are not monuments; they are living structures, maintained by hearing, speaking, acting, fellowship and prayer in the Spirit. And remember why heaven rebuilt you: foundations exist to carry weight. God does not renovate believers for museum display — greater assignments are coming that your old cracked slab could never have supported: the vision He will show you, the people He will send you, the battles ahead in this journey. Jesus finished His greatest sermon with a builder''s warning and promise: rains will come to every house — and the house on the rock stands (Matthew 7:24–25). Rains will come to yours. Let them. You have been rebuilding on rock.'),
  (15, 3, 'talk', 'Talk it Over', NULL, '— What maintenance rhythm will keep your foundation strong — name your weekly practices?

— What "weight" do you sense God preparing your rebuilt foundation to carry?'),
  (15, 4, 'devotional', 'Pray', NULL, 'Father, keep me building — hearing, speaking, acting, praying in the Spirit. Load the weight You have prepared; this house is on the Rock, and the Rock does not move. Amen.

_May every storm that visits your rebuilt house leave a testimony instead of damage._'),
  (15, 5, 'reading', 'Go Deeper', NULL, 'Jude 20–25; Matthew 7:24–27')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- better-together (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('better-together', 'Better Together', 'Relationships that build destiny', 'No man becomes alone. Look closely at any life that has amounted to something and you will find, standing behind it, a web of relationships that carried it — a praying mother, a covenant friend, a wise mentor, a faithful partner. Destiny is not a solo performance; it is a cord — and cords are woven. Our generation is the most connected and least accompanied in history: a thousand contacts, and no one to call at midnight. This plan is heaven''s answer to that ache. For ten days we walk with the great pairs of Scripture — Jesus and His twelve, David and Jonathan, Ruth and Naomi, Paul and Timothy — learning to choose, keep, and become the relationships destiny requires.', 'Relationships', 10, 18, 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
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
  (1, 1, 'scripture', 'Today''s Reading', 'Mark 3:14', '“He appointed twelve that they might be with him and that he might send them out to preach.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Begin with a fact that should end all lone-ranger Christianity: the Son of God did not walk alone. He chose twelve — and read their first job description carefully: that they might be with him. Before preaching, before power — presence. Companionship was the first assignment. And out of the twelve He drew three — Peter, James, John — into His most private rooms: the mountain of transfiguration, the house of Jairus, the garden of Gethsemane. Even perfection kept an inner circle. If the Sinless One structured His life around chosen companionship, who are you and I to attempt destiny without it? This plan begins with the humility of that admission: I was not designed for alone. Then it turns to the joyful work: choosing, keeping and becoming the company destiny requires.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— Where has "I can manage alone" been governing your life — and what has it cost?

— Who currently qualifies as your "with him" people — presence, not just contact?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You chose companions — so I lay down the pride of alone. Choose my twelve and my three with me, and teach me the first assignment: presence. Amen.

_May the loneliness of managing alone be replaced by the strength of chosen company._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Mark 3:13–19; Luke 6:12–16'),
  (2, 1, 'scripture', 'Today''s Reading', 'Ecclesiastes 4:9–10, 12', '“Two are better than one, because they have a good return for their labor: if either of them falls down, one can help the other up… A cord of three strands is not quickly broken.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'The Preacher gives partnership its economics: two are better than one because the return is better — in labor, in warmth, in defense, in rescue when one falls. Alone is not just lonely; alone is expensive. Then comes the upgrade: a cord of three strands is not quickly broken. Two believers woven with Christ Himself as the third strand form the strongest structure on earth — “where two or three gather in my name, there am I with them” (Matthew 18:20). Take the audit today: in your labor, who shares the load? In your falling, who lifts you? In your battles, who stands back-to-back with you? Where the answer is “no one,” you have found not a shame but a prayer target. Cords are woven — and weaving can begin this week.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Run the audit: labor, falling, battle — who is woven in at each point?

— Where will you begin weaving this week — one invitation, one commitment?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, weave my cord. Bring the strands You have chosen, make Christ the third in every binding, and let my life stop paying the expensive price of alone. Amen.

_May your life be woven this season into cords no trouble can quickly break._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Ecclesiastes 4:7–12; Matthew 18:19–20'),
  (3, 1, 'scripture', 'Today''s Reading', 'Proverbs 27:17', '“As iron sharpens iron, so one person sharpens another.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Notice the metallurgy: iron is not sharpened by wool or by wood — it takes iron to sharpen iron. Comfortable company keeps you comfortable; only peers of substance, close enough to strike edges with you, make you sharper. Sharpening has sparks. The friend who questions your excuse, corrects your doctrine, tells you the truth about your attitude — that friction is not the failure of friendship but the function of it. “Wounds from a friend can be trusted, but an enemy multiplies kisses” (Proverbs 27:6). Beware a circle that only applauds you; you are either their superior or their fool. So seek iron: men and women your own size or beyond, walking the same road, licensed to speak into you. And be iron — loving enough to spark when a friend''s edge dulls. Mutual sharpening is the gymnasium of becoming.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Who is licensed to correct you — truly licensed, and used recently?

— Whose edge have you watched dull while you stayed politely silent?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, bring iron into my life and make me iron in others''. Give me friends who spark, the humility to receive it, and the love to return it. Amen.

_May every spark in your friendships leave both blades sharper for battle._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 27:5–6, 17; Hebrews 3:13'),
  (4, 1, 'scripture', 'Today''s Reading', '1 Samuel 23:16', '“And Saul’s son Jonathan went to David at Horesh and helped him find strength in God.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'David was a fugitive in the wilderness of Ziph — anointed years ago, hunted daily, faith wearing thin. And into that wilderness walked Jonathan, the king''s own son, for one recorded purpose: he helped him find strength in God. Mark what covenant friendship does at its highest: it does not merely sympathize (“poor David”), nor merely assist (“here is bread”). It re-anchors the soul in God — reminding a tired man of what heaven said about him: “You will be king over Israel.” Jonathan strengthened David''s grip on his own prophecy. One such friend in your wilderness is worth more than a thousand admirers in your palace. Do you have one? Are you one? The measure is simple: after time with you, do people find their strength in God increased — or only their complaints better rehearsed?'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Who has walked into your wilderness and re-anchored you in God? Thank them today.

— Whose wilderness needs your Jonathan-visit this week?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, give me Jonathan friendship — to have, and to be. Send me to someone''s Horesh this week, and let them find strength in God because I came. Amen.

_May every wilderness of your life be interrupted by a covenant friend at the right hour._'),
  (4, 5, 'reading', 'Go Deeper', NULL, '1 Samuel 23:14–18; 18:1–4'),
  (5, 1, 'scripture', 'Today''s Reading', '1 Kings 12:8', '“But Rehoboam rejected the advice the elders gave him and consulted the young men who had grown up with him and were serving him.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Rehoboam inherited the largest kingdom his family would ever hold — and lost ten of twelve tribes in a single afternoon. The instrument of the loss was not an army. It was a circle: he dismissed seasoned counsel and listened to “the young men who had grown up with him,” who told him what his ego enjoyed hearing. Scripture is tender but unbending: “Do not be misled: bad company corrupts good character” (1 Corinthians 15:33) — present tense, patient, like water shaping stone. Your closest voices calibrate your normal: their ethics become thinkable to you, their fears contagious, their ceilings inherited. This is not a call to despise anyone; it is a call to assign seats wisely. Everyone deserves your love; not everyone earns your ear. Ask of your inner circle: are these voices building the person my book requires — or applauding the person my flesh prefers?'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Whose counsel do you actually consult — elders of wisdom, or echoes of your ego?

— Does any seat at your inner table need reassigning — gently, lovingly, firmly?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, save me from Rehoboam''s afternoon. Give me love for all, ears for the wise, and courage to reassign the seats my destiny cannot afford. Amen.

_May your table be seated by wisdom — and your kingdom kept whole because of it._'),
  (5, 5, 'reading', 'Go Deeper', NULL, '1 Kings 12:1–19; Proverbs 13:20'),
  (6, 1, 'scripture', 'Today''s Reading', 'Matthew 18:19', '“Again, truly I tell you that if two of you on earth agree about anything they ask for, it will be done for you by my Father in heaven.”'),
  (6, 2, 'devotional', 'Devotional', NULL, '“Can two walk together, except they be agreed?” (Amos 3:3). Agreement is more than company — it is alignment, and heaven attaches staggering mathematics to it: one can chase a thousand, but two can put ten thousand to flight (Deuteronomy 32:30). Not addition — multiplication. Jesus raises it higher still: two on earth, agreeing in prayer, engage the Father''s action. Agreement is a spiritual technology — which is exactly why the enemy''s first strategy against every partnership, marriage and church is division. He cannot match multiplied power, so he attacks the multiplication itself. So become a guardian of agreement: settle offenses quickly, keep short accounts, refuse the whisperer who separates close friends (Proverbs 16:28). And harness it deliberately — find your prayer-agreement partner and name your battles together. Ten thousand are waiting to flee.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— Where is disagreement currently draining multiplication from your life?

— Who will be your Matthew 18:19 agreement partner — and over what first request?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Father, make me a guardian of agreement — quick to reconcile, deaf to whisperers. And join me to a partner of prayer whose amen multiplies mine. Amen.

_May the mathematics of agreement begin multiplying everything you build._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Matthew 18:15–20; Deuteronomy 32:30'),
  (7, 1, 'scripture', 'Today''s Reading', 'Job 42:10', '“After Job had prayed for his friends, the Lord restored his fortunes and gave him twice as much as he had before.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Relationships are sustained by what you invest in secret — and the deepest investment is intercession. Watch the timing in Job''s story, for it is one of Scripture''s quietest wonders: not after Job defended himself, not after his friends apologized properly — after Job prayed for his friends, the Lord restored his fortunes double. And these were the friends who had wounded him with bad theology for thirty chapters! Praying for them healed something praying about himself never touched — and unlocked a restoration heaven had apparently scheduled behind that very obedience. Samuel went further: “far be it from me that I should sin against the Lord by failing to pray for you” (1 Samuel 12:23) — prayerlessness for his people he counted as sin. So build the roll: family, friends, leaders, the difficult ones by name. Some of your own restorations are waiting on your intercession for others.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Who has wounded you that God may be inviting you to pray for — Job-style?

— Build your intercession roll today: which names, what rhythm?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, I take up the priesthood of my relationships. Here are my people — the beloved and the difficult — by name. Bless them richly; and do in me whatever the praying unlocks. Amen.

_May double restoration find you on your knees for somebody else._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Job 42:7–10; 1 Samuel 12:19–24'),
  (8, 1, 'scripture', 'Today''s Reading', 'Romans 16:3–5', '“Greet Priscilla and Aquila, my co-workers in Christ Jesus. They risked their lives for me… Greet also the church that meets at their house.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Every mention of this couple in Scripture — and there are six — names them together. They made tents together, traveled with Paul together, discipled the mighty Apollos together (“they invited him to their home and explained the way of God more adequately”), and hosted a church in their house together. One flesh, one work. Here is partnership at full stature: not two people merely sharing an address, but two people sharing an assignment. Their marriage was a ministry unit; their business funded mission; their home was infrastructure for the kingdom. Whatever your state — married, engaged, hoping, or single with close co-laborers — study them: “He who finds a wife finds what is good and receives favor from the Lord” (Proverbs 18:22), and the partnership that prays, works and serves as one becomes something the New Testament greets by name. Choose partners in prayer, not in appetite; and build the kind of togetherness heaven writes letters to.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— If partnered: do you share an address or an assignment? What would deepen it?

— If believing for partnership: what are you becoming, so that two can serve as one?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, build my partnerships to Aquila-and-Priscilla stature — one heart, one work, a home that heaven uses. Let those closest to me be co-workers in Christ. Amen.

_May your closest partnership become infrastructure for the Kingdom of God._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Acts 18:1–3, 18–26; Romans 16:3–5'),
  (9, 1, 'scripture', 'Today''s Reading', '2 Timothy 2:2', '“And the things you have heard me say in the presence of many witnesses entrust to reliable people who will also be qualified to teach others.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'Destiny travels on a two-way road: someone ahead of you, someone behind you. Elisha poured water on Elijah''s hands — and inherited a double portion. Timothy served Paul “as a son with his father” — and inherited churches. The men who received mantles were first men who carried someone''s luggage without bitterness. Read today''s verse and count the generations: what I said, you entrust to reliable people who teach others — four spiritual generations in one sentence. That is heaven''s succession plan, and it needs you in two positions at once: receiving as a son, transmitting as a father. The man who only networks upward builds a ladder; the man who invests in both directions builds a legacy. So find your Elijah — and serve, not just consume. And find your Elisha — and pour, not just perform. Becoming was never meant to die with you.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Who is ahead of you that you serve — and who behind you that you lift?

— Which position is vacant — mentor or son — and how will you fill it this season?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, set me in the succession: a faithful son to my Elijah, a generous father to my Elisha. Let what You gave me reach the fourth generation. Amen.

_May your becoming outlive you by four generations at least._'),
  (9, 5, 'reading', 'Go Deeper', NULL, '2 Kings 2:1–15; 2 Timothy 2:1–2'),
  (10, 1, 'scripture', 'Today''s Reading', '1 Corinthians 12:27', '“Now you are the body of Christ, and each one of you is a part of it.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'All these relationships — iron peers, Jonathans, mentors, partners — grow in one appointed greenhouse: the body of Christ, gathered and local. “Those planted in the house of the Lord will flourish in the courts of our God” (Psalm 92:13). Planted — not visiting, not sampling, not streaming from a distance. Rooted. The body is where your gifts find their function (“each one of you is a part of it”), where your rough edges meet their sharpening, where you are known well enough to be helped and needed enough to grow. A coal in the fire glows; a coal on the hearth cools — it is not weakness to need the fire; it is design. So end this plan with the strongest commitment of all: plant yourself. Join, serve, submit, stay — through seasons dry and green. The stronger your relationships, the stronger your leadership; and the deepest relationships of your life are waiting inside the commitment you keep to God''s family.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Are you planted, potted, or drifting — honestly?

— What would full planting look like: membership, serving where, accountable to whom?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, plant me in Your house. Give me roots that hold through every season, brothers and sisters who become my cord, and fruit that proves the planting. Amen.

_May you flourish, deeply planted, in the courts of our God — never alone again._'),
  (10, 5, 'reading', 'Go Deeper', NULL, '1 Corinthians 12:12–27; Psalm 92:12–15')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- prepared-in-secret (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('prepared-in-secret', 'Prepared in Secret', 'Ten days for your hidden season', 'Nobody applauds a foundation. It is dug in obscurity, poured in silence, and buried before the building rises — yet everything visible stands on it. If you are in a hidden season — overlooked, waiting, serving quietly while others shine — this plan was written for your exact address. Here is the secret the impatient never learn: greatness happens through intense preparation. Heaven''s greatest ones were all grown in obscurity first — Jesus had thirty hidden years and eighteen silent ones; David had sheep pens; Joseph had a prison; Moses had a desert; Esther had twelve months of oil. Your hidden season is not God forgetting you. It is God preparing you. For ten days, we learn to cooperate with the making.', 'Purpose', 10, 19, 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'prepared-in-secret');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Luke 2:52', 'The Hidden Years of the Son of God'),
  (2, 'Isaiah 40:31', 'The Eagle Renews in Hiding'),
  (3, 'Luke 2:46', 'Found Among the Teachers, Asking Questions'),
  (4, 'Luke 14:28', 'Count the Cost, Build the Tower'),
  (5, 'Psalm 78:70–71', 'The Sheep Pens Before the Throne'),
  (6, 'Psalm 105:19', 'Joseph: Prepared by the Very Delay'),
  (7, 'Exodus 3:1', 'The Desert Curriculum'),
  (8, 'Esther 2:12', 'Esther''s Twelve Months of Oil'),
  (9, 'Ecclesiastes 9:11', 'Chance Favors the Prepared'),
  (10, 'Luke 16:12', 'Faithful in Another Man''s Vineyard')
) AS v(n, ref, title) WHERE p.code = 'prepared-in-secret';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'prepared-in-secret'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Luke 2:52', '“And Jesus grew in wisdom and stature, and in favor with God and man.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'The most important life ever lived was ninety percent hidden. Thirty years in Nazareth — a carpenter''s bench, a village''s dust, an ordinary name — before three years of public ministry. From age twelve, the Scripture goes silent for eighteen years, summarized in one sentence: He grew. If the Son of God did not skip the hidden years, they cannot be a punishment. They are a curriculum. In Nazareth, Jesus practiced everything He would later preach: honoring parents, handling money, serving neighbors, waiting on the Father''s timing while carrying the world''s greatest calling unannounced. So begin this plan by re-labeling your season. Not “forgotten.” Not “passed over.” Growing in wisdom, stature and favor — the same file heaven kept on Jesus. Hidden is not the opposite of chosen. For a long and holy stretch, hidden is what chosen looks like.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What label have you been writing on your hidden season?

— What might the Nazareth curriculum be teaching you right now?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, You honored the hidden years — so I will honor mine. Re-label my season with heaven''s file: growing in wisdom, stature and favor. Amen.

_May you carry your hidden season the way Jesus carried Nazareth — unhurried and unashamed._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Luke 2:41–52; Philippians 2:5–11'),
  (2, 1, 'scripture', 'Today''s Reading', 'Isaiah 40:31', '“But those who hope in the Lord will renew their strength. They will soar on wings like eagles…”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'There is a season when the eagle — the very king of the skies — withdraws from view. Feathers weathered, beak worn, it retreats to the heights and goes through a painful renewal: old plumage shed, new strength grown. The bird that finally rises looks reborn — because it is. The eagle does not molt in mid-air, and neither do you. Some renewals require withdrawal: seasons when God takes you off the stage not to shelve you but to re-feather you — new strength, new sharpness, new wind. If your visibility has shrunk lately, ask before you panic: is this rejection, or renewal? “Those who hope in the Lord will renew their strength” — and renewal has always loved privacy. Cooperate with the molting. What rises from this hiding will out-fly what entered it.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Could your reduced visibility be renewal rather than rejection?

— What "old feathers" — methods, dependencies, self-images — is God shedding from you?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, I stop fighting the hiding. Renew me in it — shed what is worn, grow what is new, and when You lift me, let me soar on fresh wings. Amen.

_May you leave this hidden season wearing wings it grew for you._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Isaiah 40:27–31; Psalm 103:5'),
  (3, 1, 'scripture', 'Today''s Reading', 'Luke 2:46', '“After three days they found him in the temple courts, sitting among the teachers, listening to them and asking them questions.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'Catch the one glimpse we have of the hidden Jesus: twelve years old, in the temple — not performing, but listening and asking questions. The posture of preparation is the posture of a learner. At age twelve, Jesus was asking hard questions in the temple; from that day, for eighteen years, the Bible is silent — until a prepared Man stepped into the Jordan. The silence was not empty. It was study. Hidden seasons are learning seasons, and the tragedy is to spend them sulking instead of studying. What should this season teach you? The skill your future assignment requires? The Scriptures you have skimmed but never mined? The craft, the language, the patience? Sit among the teachers — books, mentors, the Word — listening and asking. When your Jordan moment comes, you will step into it prepared.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— What is this season offering to teach that you have been too frustrated to learn?

— "Sit among the teachers": which book, mentor or study will you take up this month?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, turn my waiting room into a classroom. Give me the twelve-year-old''s posture — listening, asking, learning — until the Jordan calls my name. Amen.

_May your hidden years be found, later, to have been your best-attended school._'),
  (3, 5, 'reading', 'Go Deeper', NULL, 'Luke 2:41–52; Proverbs 4:5–9'),
  (4, 1, 'scripture', 'Today''s Reading', 'Luke 14:28', '“Suppose one of you wants to build a tower. Won’t you first sit down and estimate the cost to see if you have enough money to complete it?”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Greatness happens through intense preparation — and Jesus gives preparation its picture: a builder, seated, counting the cost before the tower rises. Counting the cost means seeing whether you have what it takes to finish the building, and gathering it before you begin. This is the hidden season''s great privilege: you can gather now what the assignment will spend later. Character enough to survive promotion. Prayer depth enough to survive pressure. Skill enough to survive scrutiny. Half-built towers advertise unprepared builders — and many public collapses are simply private preparations that never happened. God created us great — but some people sought permission to be petty; they wanted towers without arithmetic. Not you. Sit down today with your calling and count honestly: what will finishing require that you do not yet have? That list is your hidden season''s syllabus.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— What will your calling''s "tower" require that you do not yet possess?

— Turn the gap into a syllabus: what will you gather this season?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Master Builder, I sit down and count. Show me the true cost of my calling, and let this hidden season gather everything the finishing will spend. Amen.

_May your tower, when it rises, testify of the seasons you sat and counted._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Luke 14:25–33; Proverbs 24:27'),
  (5, 1, 'scripture', 'Today''s Reading', 'Psalm 78:70–71', '“He chose David his servant and took him from the sheep pens; from tending the sheep he brought him to be the shepherd of his people Jacob.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'When Samuel came to anoint a king, David was not even invited to the lineup — the youngest, left with the flock, forgotten by his own father in the day of selection. But hear the Psalm''s geography of promotion: God took him from the sheep pens. Heaven knew the address of the overlooked boy. And the pens were not wasted years; they were the throne''s curriculum. Watching sheep taught him to watch people; fighting lions calibrated him for giants; solitary nights with a harp wrote the psalms a nation still prays. Same skills, larger flock. Notice too: even after anointing, David returned to the sheep. Anointed, and still hidden — the oil on his head and the wool in his hands. If that is your season — confirmed calling, unchanged circumstances — you are in royal company. The God who knows the pens'' address has not misplaced yours.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Where have you felt "left out of the lineup" — and can you trust heaven knows your address?

— What is your current "flock" teaching that your future "kingdom" will need?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, You take people from sheep pens. I will tend what is before me with all my heart — anointed or overlooked — until You come for me at the address You have always known. Amen.

_May the oil on your head keep you faithful with the wool in your hands._'),
  (5, 5, 'reading', 'Go Deeper', NULL, '1 Samuel 16:1–13; Psalm 78:70–72'),
  (6, 1, 'scripture', 'Today''s Reading', 'Psalm 105:19', '“Until the time came to fulfill his dreams, the Lord tested Joseph’s character.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Between Joseph''s dream and Joseph''s throne stood thirteen years of descent — a pit, a slave''s quarters, a dungeon. Any observer would have said the dream had died three times. But read what heaven was doing in the same years: the word of the Lord tested him. And look closer: every station was secretly a school for the palace. Potiphar''s house taught him to run an estate; the prison, of all places, taught him to administer people and systems. Egypt''s future prime minister did his internship in a dungeon — and the very delay became the preparation. God wastes nothing: not the betrayal, not the false accusation, not the forgotten favor (the cupbearer forgot him two full years). When the dream finally called, Joseph was ready in a single morning — shaved, dressed, and equal to a nation''s crisis. Your delays are enrollments. Attend the classes.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— What is your current "station" secretly teaching that your dream will require?

— Where has a delay tempted you to declare the dream dead?'),
  (6, 4, 'devotional', 'Pray', NULL, 'God of Joseph, I enroll in the classes of my delay. Test my character kindly, teach me in every station, and when the dream calls — find me ready in a morning. Amen.

_May every dungeon in your story turn out to have been an internship for a palace._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Genesis 37, 39–41; Psalm 105:16–22'),
  (7, 1, 'scripture', 'Today''s Reading', 'Exodus 3:1', '“Now Moses was tending the flock of Jethro his father-in-law… and he led the flock to the far side of the wilderness…”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Moses spent forty years in Pharaoh''s palace learning to be somebody; forty years in the desert learning to be nobody; and forty years showing what God can do with a man who has learned both. The middle forty looked like pure waste — a prince reduced to a shepherd on the backside of nowhere. But trace the geography: the wilderness where Moses kept sheep was the very wilderness through which he would one day lead a nation. He was mapping his future mission field and calling it exile. The wells, the weather, the ways of the desert — every ordinary day was reconnaissance. God hides His deliverers in the terrain of their coming deliverance. The organization frustrating you, the community you feel buried in, the problems you know too well — look again. You may not be buried. You may be planted, in the exact soil of your assignment.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— What "terrain" do you know intimately that felt like exile — could it be reconnaissance?

— What burning bush might be standing in your ordinary landscape?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, re-map my wilderness. If this ground is my future mission field, open my eyes — and when the bush burns, find me faithful with the flock in my hands. Amen.

_May the ground you called exile reveal itself as your appointed mission field._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Exodus 2:11–3:12; Acts 7:29–34'),
  (8, 1, 'scripture', 'Today''s Reading', 'Esther 2:12', '“Before a young woman’s turn came… she had to complete twelve months of beauty treatments prescribed for the women, six months with oil of myrrh and six with perfumes and cosmetics.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Between Esther''s selection and Esther''s crown stood a full year of preparation — twelve months of oil, prescribed and unhurried, before one evening with the king. And years later, when a nation''s survival hung on her access to the throne, every month of that preparation mattered. Notice: Esther did not design her preparation; she submitted to it. Hidden seasons often come with disciplines we would not have chosen — the humbling job, the small church, the long training, the closed door that keeps us soaking longer. The oil decides the readiness; the calendar belongs to God. And mark the destination: preparation was never about the palace''s luxury but about a moment — “for such a time as this” (Esther 4:14). Somewhere ahead of you is your such-a-time. The soaking you resent today is the composure you will reign with then.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— What prescribed "oil" — discipline, training, waiting — are you currently soaking in reluctantly?

— How does a coming "such a time as this" change the way you soak?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, I submit to the oil. Prescribe my preparation, set my calendar, and when my such-a-time comes, let twelve hidden months speak in one decisive moment. Amen.

_May every month of oil be found, at your decisive moment, to have been exactly enough._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Esther 2:8–17; 4:12–16'),
  (9, 1, 'scripture', 'Today''s Reading', 'Ecclesiastes 9:11', '“The race is not to the swift or the battle to the strong… but time and chance happen to them all.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'The Preacher noticed what we all notice: outcomes do not always follow talent. The swift lose races; the strong lose battles; time and chance happen to them all. Doors swing open unannounced — and swing shut the same way. Since opportunities cannot be scheduled, they can only be prepared for. The scientist Louis Pasteur said it in the laboratory — chance favors the prepared mind — and Scripture had staged it centuries earlier: Joseph could not have arranged Pharaoh''s dreams, but he had spent thirteen years becoming the man who could interpret them. The cupbearer''s memory returned suddenly; Joseph''s readiness had been built slowly. You cannot control when your door opens. You entirely control who is standing there when it does. Prepare as if the knock were tonight — because time and chance are already on their way to your address.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— If your biggest door opened tonight, what part of you would be unready?

— What will you do this month so the knock finds you standing?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Lord of times and seasons, I cannot schedule my door — so I will prepare for it. Build in me, slowly and surely, the readiness that sudden moments reveal. Amen.

_May every sudden door of your life find you already dressed._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Ecclesiastes 9:10–11; Genesis 41:14–40'),
  (10, 1, 'scripture', 'Today''s Reading', 'Luke 16:12', '“And if you have not been trustworthy with someone else’s property, who will give you property of your own?”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Here is the hidden season''s final exam, and it is taken daily: how do you serve what belongs to someone else? Another leader''s vision. Another company''s growth. Another ministry''s platform. Jesus makes the principle explicit — your own comes to those proven trustworthy with another''s. Elisha poured water on Elijah''s hands for years — and inherited a double portion. Joshua carried Moses'' tent duties — and inherited the crossing. The men who received mantles were the men who had carried someone else''s luggage without bitterness. So close this plan with the commissioning of the hidden: serve your present assignment as if it were the dream itself — because in God''s ledger, it is. Be the armor-bearer who makes another king great. The world is too busy to stand and admire you; but heaven is not too busy — it is watching, recording, and preparing your own vineyard even now.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Whose "vineyard" are you serving now — and with how much of your heart?

— What would wholehearted service look like this week, applause or none?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, I take the towel in another man''s vineyard with joy. Find me trustworthy with what is his — and in Your time, hand me what is mine. Amen.

_May your faithfulness in another''s vineyard be answered with a harvest in your own._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Luke 16:10–12; 2 Kings 2:1–14')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- readers-become-leaders (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('readers-become-leaders', 'Readers Become Leaders', 'Ten days on the power of books', 'Show me a leader and I will show you a reader. Behind most great lives stands a stack of books — mentors on paper, nations visited without a passport, decades of another person''s learning absorbed in days. Reading is the most affordable miracle in the world: you can bring the whole world to your room. And for the believer, reading begins at a burning center: our God is a God of the Book. He wrote your days in a volume before one of them came to be, gave His revelation in writing, and when His Son arrived, He was called the Word. Ten days to build a reading life: why it matters, how to squeeze the juice, what our fathers of faith read — and how what you read today will show tomorrow.', 'Growth', 10, 20, 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
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
  (1, 1, 'scripture', 'Today''s Reading', 'John 1:1, 14', '“In the beginning was the Word, and the Word was with God, and the Word was God… The Word became flesh and made his dwelling among us.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Christianity is a reading faith because it worships a speaking God. He created by words, revealed Himself in a written Book, and when He came in person, His name was the Word. To love this God is to love language, meaning, and the page. Notice what Jesus assumed of His hearers: “Have you not read…?” — again and again. He answered the devil from the written Word, opened the scroll in Nazareth and read His own commissioning, and after resurrection He walked two disciples through “Moses and all the Prophets.” The Master was a reader. So this plan is discipleship, not self-improvement. We read because our God writes — and every book we ever open is measured against the Book that reads us.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What is your current relationship with reading — feast, famine, or snack?

— What would it mean this month to follow a Master who asked, "Have you not read?"'),
  (1, 4, 'devotional', 'Pray', NULL, 'Living Word, make me a lover of the written word — beginning with Yours. Open my eyes to see wonderful things in Your law, and give me a reader''s heart. Amen.

_May the Word who became flesh make every page you read a place of meeting._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'John 1:1–18; Luke 4:16–21'),
  (2, 1, 'scripture', 'Today''s Reading', 'Hebrews 4:12', '“For the word of God is alive and active. Sharper than any double-edged sword…”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'You already know the law of the gates: whatever feeds your mind is farming your mind. Reading is deliberate agriculture — you choose the seed, you choose the field, you choose the season. No other input gives you such control over your own formation. A mind fed on gossip grows suspicion; a mind fed on screens alone grows restless and shallow; a mind fed on great books grows large rooms — rooms of history, wisdom, empathy and vision that circumstances cannot demolish. And a mind fed on the living Word grows something sharper still: discernment that divides soul from spirit. Poverty may surround a body, but it needs your permission to enter a mind — and books are how the siege is broken. Choose your seed today: what are you currently reading, and what is it planting?'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— What has your reading (or its absence) been farming in you this year?

— Choose deliberately: what seed goes into the field next?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, I take up the farmer''s responsibility for my own mind. Choose the seed with me, and let this year''s reading grow rooms in me that blessing can fill. Amen.

_May your mind become farmland so well-planted that every season yields wisdom._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Hebrews 4:12–13; Proverbs 2:1–6'),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 2:15', '“Do your best to present yourself to God as one approved, a worker who does not need to be ashamed and who correctly handles the word of truth.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'There is reading that decorates and reading that nourishes — and the difference is not the book but the squeezing. Read, think; read, ponder; read, meditate — squeeze the virtue of what you are reading like you squeeze juice from an orange fruit. Pages turned are not nutrition gained. The squeezer''s tools are simple: a pen (mark what strikes you), a question (what does this mean, and what do I do with it?), a pause (stop at the sentence that burns and stay there), and a notebook (what is written down is owned; what is merely admired evaporates). One book squeezed will change you more than twenty books skimmed. So slow down this week. You are not in a race against other readers; you are at a table, and the meal deserves chewing.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Are you a page-turner or a juice-squeezer — honestly?

— Take today''s reading: what one sentence deserves a full stop and a notebook?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, deliver me from decorative reading. Teach me to squeeze — to think, ponder and meditate until the virtue of the page enters the bloodstream of my life. Amen.

_May every orange you squeeze this week fill your cup to running over._'),
  (3, 5, 'reading', 'Go Deeper', NULL, '2 Timothy 2:15; Psalm 119:97–104'),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 1:1–3', '“Blessed is the one… whose delight is in the law of the Lord, and who meditates on his law day and night. That person is like a tree planted by streams of water, which yields its fruit in season.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Here is the reader''s law of harvest: if you read today, it will show tomorrow. If you don''t read today — that will also show tomorrow. Either way, tomorrow tells. Reading works like compounding interest: invisible daily, unmistakable over years. The vocabulary that carries your ideas, the judgment that navigates your decisions, the reservoir your conversations draw from, the calm of a mind that has seen how many storms end — all of it accrues page by page, or fails to. The Psalm''s tree does not strain to fruit; it fruits because of where it is planted and what it drinks daily. So plant yourself: a fixed time, a fixed place, pages before pixels. Fifteen pages a day is over five thousand pages a year — a shelf of transformation hiding inside your ordinary mornings.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— What has already "shown" in your life from reading — or from its absence?

— Fix it now: what time, what place, how many pages daily?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, plant me by the streams. I commit my daily pages — small, fixed and faithful — and I trust You for the season of fruit that will surely show. Amen.

_May your quiet daily pages compound into a visibly blessed life._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Psalm 1; Joshua 1:8'),
  (5, 1, 'scripture', 'Today''s Reading', '2 Timothy 4:13', '“When you come, bring the cloak that I left with Carpus at Troas, and my scrolls, especially the parchments.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'This request comes from Paul''s final letter, written from a death-row cell: an old apostle, who had seen the third heaven and written half the New Testament, asking for three things — his coat, his scrolls, and especially the parchments. Facing winter and execution, Paul wanted warmth and books. Let the scene correct us. If revelation of Paul''s magnitude did not retire him from reading, no anointing retires you. If a man that near to glory still valued study, no season of life outgrows it. The learners keep leading because the leaders keep learning. There is no arrival point where the mind may close. Whatever your age, degree or experience — somewhere there is a coat, a scroll and a parchment with your name on it. Send for them.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Have you quietly "retired" from learning — and when did it happen?

— What are your "parchments" — the reading your next season requires?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Father, give me Paul''s dying appetite — still learning, still asking for the parchments. Keep my mind open and my desk stocked until the day I see You. Amen.

_May you be found, at every age, with fresh parchments open on your desk._'),
  (5, 5, 'reading', 'Go Deeper', NULL, '2 Timothy 4:9–13; Proverbs 18:15'),
  (6, 1, 'scripture', 'Today''s Reading', 'Daniel 9:2', '“In the first year of his reign, I, Daniel, understood from the Scriptures, according to the word of the Lord given to Jeremiah the prophet, that the desolation of Jerusalem would last seventy years.”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'One of history''s mightiest prayer movements began with a man reading. Daniel, in his study of Jeremiah''s scroll, understood from the Scriptures that the exile''s seventy years were ending — and that understanding drove him to the fasting, sackcloth prayer of Daniel 9, which summoned the angel Gabriel with revelation that reaches to the end of the age. Mark the sequence, for it is a whole theology of reading: the page produced understanding; understanding produced intercession; intercession produced visitation. Daniel did not stumble into his moment — he read his way into it. There are timings, promises and assignments waiting in texts you have not yet opened — in the Word first, and in the wisdom of the ages besides. Some breakthroughs are not being withheld. They are being unread.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— What might currently be "unread" in your life — promises or wisdom waiting in unopened texts?

— What understanding, if you gained it, would change how you pray?'),
  (6, 4, 'devotional', 'Pray', NULL, 'God of Daniel, let my reading produce understanding, my understanding produce prayer, and my prayer produce visitation. Show me the scroll for my season. Amen.

_May something you read this month send you to your knees — and heaven to your door._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'Daniel 9:1–23; Jeremiah 29:10–14'),
  (7, 1, 'scripture', 'Today''s Reading', 'Deuteronomy 17:18–19', '“When he takes the throne of his kingdom, he is to write for himself on a scroll a copy of this law… It is to be with him, and he is to read it all the days of his life.”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'Before Israel ever had a king, God legislated the king''s reading habits: on taking the throne, he must personally hand-copy the Book, keep it beside him, and read it all the days of his life — “so that he may learn to revere the Lord… and not consider himself better than his fellow Israelites.” Heaven''s logic is plain: authority without daily reading becomes arrogance; power without the page drifts. The bigger your responsibility — home, business, ministry, office — the more binding the king''s law becomes on you. Leaders who stop reading start assuming, and people pay for leaders'' assumptions. Notice too the method: write for himself — slow, personal, by hand. Copy out the texts that must govern you; what passes through your own hand governs deeper than what passes before your eyes. Readers become leaders — and remain safe ones.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— As responsibility has grown, has your reading grown with it — or thinned?

— What governing text will you hand-copy this week, king-style?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Father, bind the king''s law on me: the Book beside me, read all my days, copied by my own hand — so that authority never outgrows reverence in me. Amen.

_May every increase of your authority be matched by an increase of your reading._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Deuteronomy 17:14–20; 1 Kings 2:1–4'),
  (8, 1, 'scripture', 'Today''s Reading', 'Proverbs 9:9', '“Instruct the wise and they will be wiser still; teach the righteous and they will add to their learning.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'The good thing with reading is that you can bring the world to your room. For the price of a book, Solomon tutors you in wisdom, Paul in grace, and the great men and women of every age in leadership, finance, healing and prayer. Mentors who would never fit in your schedule sit patiently on your shelf, available at midnight. This is God''s mercy to the man of humble beginnings: the boy who missed school terms can still out-learn his generation, because libraries do not check family names. Many walls that poverty builds, reading quietly dismantles. So build your council of paper mentors deliberately: biographies of the greatly used, the classics of prayer and faith, the craft books of your calling. Choose mentors whose fruit you would want — for whoever disciples your mind will eventually direct your feet.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Who currently sits on your "council of paper mentors" — and who is missing?

— Which biography or classic will you appoint to the council this month?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, assemble my council. Bring to my room, through books, the mentors my becoming requires — and give me the humility to sit at their feet. Amen.

_May your small room host the wisest company in the world._'),
  (8, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 9:9–12; 13:20'),
  (9, 1, 'scripture', 'Today''s Reading', 'Philippians 4:8', '“Finally, brothers and sisters, whatever is true, whatever is noble… think about such things.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'A serious reader needs one more instrument: a filter. Not every page deserves your bloodstream — some books carry sweet-tasting error, and an undiscerning reader farms weeds with great diligence. “Test them all; hold on to what is good” (1 Thessalonians 5:21). The filter is the Book itself. Scripture is the standard weight against which every idea is measured: read widely, but weigh biblically. When an author''s counsel contradicts the Word, the author loses — however famous the name or beautiful the prose. The Bereans were called noble precisely for this: they received teaching eagerly and examined the Scriptures daily to see if it was true (Acts 17:11). So keep the Word central in your reading life — the first book of the day, the lens for all the others. Readers who weigh become leaders who cannot be easily deceived.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— Do you currently read with a filter, or does everything get equal access?

— Where has a persuasive book quietly out-voted Scripture in your thinking?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Father, make Your Word the scale on my desk. I will read widely and weigh everything — holding fast the good, releasing the rest, deceived by none. Amen.

_May you grow into a reader whom error finds difficult and truth finds hospitable._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Acts 17:10–12; 1 Thessalonians 5:19–22'),
  (10, 1, 'scripture', 'Today''s Reading', 'Deuteronomy 6:6–7', '“These commandments that I give you today are to be on your hearts. Impress them on your children. Talk about them when you sit at home and when you walk along the road…”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Your reading life was never meant to end with you. The final movement of a reader''s becoming is transmission: raising readers, and leaving libraries — in shelves and in souls. Impress the words on your children: let them see you reading (children imitate spines they observe), read to them, fill the house with books the way other houses are filled with noise. Timothy''s faith was traced to a grandmother and mother who put the sacred writings in his childhood hands (2 Timothy 1:5; 3:15). Two women''s reading culture produced an apostle''s son. And beyond your house: gift books, start a reading circle, build the church library, put the right volume in the right young hand at the right moment. Whole destinies have pivoted on a given book. Go now — read today, for it will show tomorrow; and plant readers, for they will show in generations.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Who saw you reading this month — and who could?

— Which book will you place in which young hand, deliberately, this season?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, make my reading generational. Let my children catch the appetite, my circle catch the culture, and some young Timothy receive from my hand the book that turns his life. Amen.

_May shelves you planted feed minds you will never meet — until the Day reveals the harvest._'),
  (10, 5, 'reading', 'Go Deeper', NULL, 'Deuteronomy 6:4–9; 2 Timothy 1:5, 3:14–15')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- ====================================================================
-- whats-in-your-hand (10 days)
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('whats-in-your-hand', 'What''s in Your Hand?', 'Ten days to discover your gifts', 'Many people spend their lives waiting for what they do not have — the capital, the connection, the qualification — while carrying, unexamined, everything heaven already issued them. When Moses protested his emptiness at the burning bush, God asked him one question that reorganized history: “What is that in your hand?” A shepherd''s staff — ordinary, familiar, forty years old — became the rod that split a sea. That is the pattern of God: He begins with what you already carry. For ten days we will open your hands and take inventory. Gifts you were born with, skills you have grown, graces the Spirit has added — named, fanned into flame, and put to work. You are more equipped than you have ever been told.', 'Gifts', 10, 21, 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'whats-in-your-hand');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Ephesians 4:7–8', 'The Giver Has Already Given'),
  (2, 'Exodus 4:2', 'What Is That in Your Hand?'),
  (3, '2 Timothy 1:6', 'Gifts, Skills and Graces'),
  (4, 'Proverbs 18:16', 'Your Gift Will Make Room for You'),
  (5, '2 Timothy 1:6–7', 'Fan It Into Flame'),
  (6, 'John 6:9', 'Five Loaves in the Right Hands'),
  (7, 'Exodus 31:2–4', 'Bezalel: When Craftsmanship Is Calling'),
  (8, '1 Peter 4:10', 'Gifts Are Discovered Serving'),
  (9, 'Matthew 25:24–25', 'The Peril of the Buried Talent'),
  (10, '1 Corinthians 12:7', 'Gifted for Your Generation')
) AS v(n, ref, title) WHERE p.code = 'whats-in-your-hand';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'whats-in-your-hand'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Ephesians 4:7–8', '“But to each one of us grace has been given as Christ apportioned it. This is why it says: “When he ascended on high, he took many captives and gave gifts to his people.”'),
  (1, 2, 'devotional', 'Devotional', NULL, 'Begin with the settled fact: the ascended Christ gave gifts to his people — and “each one of us” received as He apportioned. Gifting in the kingdom is not a lottery some lost; it is an inheritance every child holds. This matters because many believers relate to gifting from a posture of lack: everyone else got something. Hear the verse again — to each one. The question of this plan is never whether you were gifted, but what, and where it is hiding under familiarity. Familiar gifts disguise themselves as “nothing special” — the thing you do easily, you assume everyone does easily. They do not. So begin with faith''s inventory posture: Lord, You gave; help me find where I put it.'),
  (1, 3, 'talk', 'Talk it Over', NULL, '— What do you do so easily you assumed "everyone" can do it?

— What have others repeatedly noticed in you that you dismissed?'),
  (1, 4, 'devotional', 'Pray', NULL, 'Ascended Lord, You gave gifts to Your people and You did not skip me. Open my eyes to what You apportioned — especially what familiarity has hidden. Amen.

_May you discover this week a treasure you have been carrying all along._'),
  (1, 5, 'reading', 'Go Deeper', NULL, 'Ephesians 4:7–13; 1 Corinthians 12:4–7'),
  (2, 1, 'scripture', 'Today''s Reading', 'Exodus 4:2', '“Then the Lord said to him, “What is that in your hand?” “A staff,” he replied.”'),
  (2, 2, 'devotional', 'Devotional', NULL, 'Moses had just listed his deficits — who am I? what shall I say? they won''t believe me — and God answered the inventory of lack with an inventory of possession: what is that in your hand? A staff. Wood. The most ordinary object in a shepherd''s world — and in God''s hands, the instrument of plagues, sea-partings and water from rock. Notice the sequence: Moses had to throw it down (surrender it) before it revealed its power, and take it up again by God''s command as “the staff of God” (Exodus 4:20). Same wood, new ownership. Your staff is whatever is already in your hand: a skill, a kitchen, a lorry, a laptop, a voice, a small shop, a network. Heaven''s question is not “what do you lack?” — it never has been. Throw down what you carry, receive it back as God''s, and watch what ordinary wood can do.'),
  (2, 3, 'talk', 'Talk it Over', NULL, '— Name honestly what is already "in your hand" — list five ordinary things.

— Which one is God asking you to throw down and receive back as His?'),
  (2, 4, 'devotional', 'Pray', NULL, 'Father, here is my staff — the ordinary things I carry. I throw them down; own them fully; hand them back anointed. Use my wood for Your wonders. Amen.

_May everything ordinary in your hands become extraordinary in His._'),
  (2, 5, 'reading', 'Go Deeper', NULL, 'Exodus 4:1–20; John 6:8–13'),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:6', '“Paul tells Timothy: For this reason I remind you to fan into flame the gift of God, which is in you through the laying on of my hands.”'),
  (3, 2, 'devotional', 'Devotional', NULL, 'It helps to sort your equipment, because it grows in three ways. Gifts are issued — capacities woven into you from birth and by the Spirit: the born encourager, the natural leader, the intercessor, the maker. Skills are farmed — abilities acquired by learning and repetition: the trade, the craft, the languages, the spreadsheets. Graces are imparted — like Timothy''s gift “through the laying on of hands,” received in the house of God, activated by faith. Confusing the categories causes grief: people wait passively for skills (which must be farmed) and strive anxiously for gifts (which must simply be discovered and fanned). So make three columns today and take inventory: what was I issued? what have I farmed? what has God imparted along the way? Clarity about what you carry is the first act of stewardship.'),
  (3, 3, 'talk', 'Talk it Over', NULL, '— Fill the three columns: issued, farmed, imparted — what goes where?

— Which column have you neglected, and what would attention look like?'),
  (3, 4, 'devotional', 'Pray', NULL, 'Father, give me an accurate inventory — the issued, the farmed, the imparted. I receive each with thanks, and I take up stewardship of all three. Amen.

_May your three columns fill up with more than you expected to find._'),
  (3, 5, 'reading', 'Go Deeper', NULL, '2 Timothy 1:6–7; Exodus 31:1–6'),
  (4, 1, 'scripture', 'Today''s Reading', 'Proverbs 18:16', '“A gift opens the way and ushers the giver into the presence of the great.”'),
  (4, 2, 'devotional', 'Devotional', NULL, 'Here is a promise to retire your elbowing: a gift opens the way — it makes room for its carrier and ushers him before the great. Doors that connections cannot open and money cannot bribe swing wide for a gift in operation. Watch it in Scripture: David''s harp skill carried a shepherd into a king''s court before his sword ever did. Joseph''s interpreting lifted him from dungeon to palace between morning and noon. Daniel''s excellence set a captive over an empire''s administrators. None of them networked their way up; their gifts were their escorts. The practical wisdom: invest in the gift, not in the pushing. Sharpen it until it speaks for itself, serve with it wherever you stand, and let it do its ancient work. Rooms you cannot imagine are already scheduled to be opened by what is in your hands.'),
  (4, 3, 'talk', 'Talk it Over', NULL, '— Have you been elbowing where you should be sharpening?

— What would a season of deliberate gift-sharpening look like?'),
  (4, 4, 'devotional', 'Pray', NULL, 'Father, I retire from pushing and I report to sharpening. Let my gift be my escort — and every room it opens, let me enter carrying Your name. Amen.

_May your gift quietly book rooms your résumé could never enter._'),
  (4, 5, 'reading', 'Go Deeper', NULL, 'Proverbs 18:16; 1 Samuel 16:14–23'),
  (5, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:6–7', '“For this reason I remind you to fan into flame the gift of God… For the Spirit God gave us does not make us timid, but gives us power, love and self-discipline.”'),
  (5, 2, 'devotional', 'Devotional', NULL, 'Timothy''s gift was real, imparted and confirmed — and apparently dimming. Paul''s remedy tells us something crucial: gifts are given as embers, not bonfires. Fan into flame — your active, continual breath is part of the design. How does one fan? Use — gifts grow only in operation, never in storage. Study — the gifted who also train become the excellent. Company — embers bundled together blaze; isolated coals cool. And courage — notice Paul immediately addresses timidity, because fear is the great smotherer of gifts. Many flames have died under the wet blanket of “who am I to…?” The Spirit in you is not timid — power, love, self-discipline. So identify your dimmed ember today and administer oxygen: one use, one study, one bold yes.'),
  (5, 3, 'talk', 'Talk it Over', NULL, '— Which gift of yours has dimmed from ember toward ash?

— What is this week''s oxygen: one use, one study, one yes?'),
  (5, 4, 'devotional', 'Pray', NULL, 'Holy Spirit, breathe with me on the embers. I renounce the timidity that smothered my gift, and I fan it into flame — with use, with learning, with courage. Amen.

_May every dimmed ember in you roar back into holy flame._'),
  (5, 5, 'reading', 'Go Deeper', NULL, '2 Timothy 1:3–7; 1 Timothy 4:14–15'),
  (6, 1, 'scripture', 'Today''s Reading', 'John 6:9', '“Here is a boy with five small barley loaves and two small fish, but how far will they go among so many?”'),
  (6, 2, 'devotional', 'Devotional', NULL, 'Andrew''s arithmetic was honest: five loaves, two fish, five thousand men — how far will they go? Every gift-carrier knows that arithmetic. My little skill, my small voice, my one talent — against needs this size? But the boy did the one thing arithmetic cannot argue with: he put what he had into the hands of Jesus. And in those hands, small stopped being small. Everyone ate; twelve baskets remained; and a boy''s lunch entered eternal Scripture. The lesson is not that your gift is bigger than you think (though it is). The lesson is that placement outranks size. Five loaves kept are five loaves; five loaves surrendered are a feeding. Stop measuring your offering against the crowd. Measure the Hands you are placing it in — then place it, daily, and let Him do the mathematics of multiplication.'),
  (6, 3, 'talk', 'Talk it Over', NULL, '— What "small lunch" have you been withholding because of the crowd''s size?

— What does placing it in His hands look like — concretely, this week?'),
  (6, 4, 'devotional', 'Pray', NULL, 'Lord Jesus, here is my lunch — small by every count but Yours. I place it in Your hands. Do Your mathematics, and let multitudes eat from what I almost kept. Amen.

_May your smallness, surrendered, out-feed every bigness that was kept._'),
  (6, 5, 'reading', 'Go Deeper', NULL, 'John 6:1–13; 2 Kings 4:1–7'),
  (7, 1, 'scripture', 'Today''s Reading', 'Exodus 31:2–4', '“See, I have chosen Bezalel… and I have filled him with the Spirit of God, with wisdom, with understanding, with knowledge and with all kinds of skills — to make artistic designs…”'),
  (7, 2, 'devotional', 'Devotional', NULL, 'The first person Scripture describes as “filled with the Spirit of God” was not a prophet or a priest. He was a craftsman — Bezalel, filled for metalwork, stonework, woodwork and design. Heaven anoints hands, not only pulpits. This demolishes the wall many carry between “sacred” gifts and “secular” ones. The accountant''s precision, the builder''s eye, the farmer''s patience, the coder''s logic, the cook''s hospitality — when consecrated, these are Bezalel gifts: the Spirit''s workmanship flowing through workmanship. So stop waiting to feel “spiritual” before you count your abilities as calling. Whatever your hands do with excellence can be filled with the Spirit and aimed at the building of God''s purposes. The sanctuary needed preachers less than it needed one anointed craftsman — and your generation''s sanctuaries are no different.'),
  (7, 3, 'talk', 'Talk it Over', NULL, '— Which of your "secular" abilities might be a Bezalel gift awaiting consecration?

— What would it mean to do your craft "filled with the Spirit" this week?'),
  (7, 4, 'devotional', 'Pray', NULL, 'Spirit of God, fill my hands the way You filled Bezalel''s. I consecrate my craft — every skill, every design, every day''s work — to the building of Your purposes. Amen.

_May your workmanship carry the unmistakable fingerprints of the Spirit._'),
  (7, 5, 'reading', 'Go Deeper', NULL, 'Exodus 31:1–11; 35:30–35'),
  (8, 1, 'scripture', 'Today''s Reading', '1 Peter 4:10', '“Each of you should use whatever gift you have received to serve others, as faithful stewards of God’s grace in its various forms.”'),
  (8, 2, 'devotional', 'Devotional', NULL, 'Here is why some people cannot find their gifts: they are searching in contemplation what is only revealed in motion. Gifts are like muscles — invisible on the couch, unmistakable under load. Peter''s instruction assumes it: use what you have received to serve others. Service is heaven''s gift-detection laboratory. Volunteer broadly and watch three gauges: what energizes you while it exhausts others; what draws sincere thanks you did not fish for; what produces disproportionate fruit for your effort. Where all three point, a gift is surfacing. Notice also Peter''s job title for you: steward of God''s grace in its various forms. The gift is God''s property in your management — which ends both pride (it was received) and neglect (it will be accounted for). So get under load this month. Your gifts are waiting in the serving.'),
  (8, 3, 'talk', 'Talk it Over', NULL, '— Where can you volunteer this month, broadly enough to test the gauges?

— What has already energized you, drawn thanks, and borne easy fruit?'),
  (8, 4, 'devotional', 'Pray', NULL, 'Father, I enter the laboratory of service. Put me under load, read the gauges with me, and surface the gifts You stored for the serving of Your people. Amen.

_May service reveal in you what a decade of self-searching never could._'),
  (8, 5, 'reading', 'Go Deeper', NULL, '1 Peter 4:8–11; Romans 12:4–8'),
  (9, 1, 'scripture', 'Today''s Reading', 'Matthew 25:24–25', '“Master,” he said, “I knew that you are a hard man… so I was afraid and went out and hid your gold in the ground.”'),
  (9, 2, 'devotional', 'Devotional', NULL, 'The servant with one talent did not squander it, steal it or lose it. He buried it — and returned it intact, expecting commendation for safety. Instead he heard the parable''s hardest words. In the kingdom''s accounting, unused is not neutral; preservation without deployment is loss. Read his motive carefully, for it lives in many of us: I was afraid. Fear of failing, fear of judgment, fear of comparison with the five-talent men — and fear, note well, rooted in a false picture of the master as harsh. The lie about God''s character produced the paralysis of God''s gift. But you know better now — fifteen days ago you rebuilt that picture. Your Master multiplies joy to faithful risk-takers: “Come and share your master''s happiness!” So hold a small exhumation today: name the buried talent, name the fear that buried it, and put a spade in the ground.'),
  (9, 3, 'talk', 'Talk it Over', NULL, '— What talent have you buried — and which fear held the spade?

— What false picture of God made the burial feel safe?'),
  (9, 4, 'devotional', 'Pray', NULL, 'Master of joy, I dig up what fear buried. Correct my picture of You, and receive my talent back into trade — I would rather risk with You than rust without You. Amen.

_May everything fear ever buried in you come up out of the ground this week._'),
  (9, 5, 'reading', 'Go Deeper', NULL, 'Matthew 25:14–30'),
  (10, 1, 'scripture', 'Today''s Reading', '1 Corinthians 12:7', '“Now to each one the manifestation of the Spirit is given for the common good.”'),
  (10, 2, 'devotional', 'Devotional', NULL, 'Take the ten-day inventory and hear its final truth: none of it was for you alone. The manifestation of the Spirit is given for the common good — your gifts are heaven''s supplies routed through your hands to your generation. This is why your gifting and your era match. The problems of your time are the address of your equipment: the skills you carry, the graces you have received, the crafts you have farmed — selected for the needs of the exact generation you were appointed to (Acts 17:26). David''s harp met Saul''s torment; Joseph''s administration met Egypt''s famine; your hands were issued for needs already on heaven''s schedule. So go and be spent. Fan the flame, keep the staff surrendered, serve under load, refuse all burials. And when your generation eats from what was in your hands, you will understand why heaven filled them.'),
  (10, 3, 'talk', 'Talk it Over', NULL, '— Which need of your generation matches what is in your hands?

— What is the first delivery you will make this month — gift to need?'),
  (10, 4, 'devotional', 'Pray', NULL, 'Father, my hands are Yours and my generation is waiting. Route Your supplies through me — every gift deployed, every talent traded, nothing buried — until my hands are empty and my book is full. Amen.

_May your generation eat well from what heaven placed in your hands._'),
  (10, 5, 'reading', 'Go Deeper', NULL, '1 Corinthians 12:4–11; Acts 13:36')
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
DELETE FROM reading_plans WHERE code IN ('believe-again', 'better-together', 'prepared-in-secret', 'readers-become-leaders', 'whats-in-your-hand');
