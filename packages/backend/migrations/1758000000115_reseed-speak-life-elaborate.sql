-- Reseed speak-life with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Before there was a world, there was a sentence. “Let there be light,” God said — and light, which had no prior existence to consult, obeyed a word. Stop and feel the strangeness of that. The universe you live in is the echo of things God said out loud.

Paul reaches back to that same speaking God to describe how Abraham was saved. Look closely at the timing in today's verse: God renamed a childless old man “a father of many nations” before there was a single son to justify the title. Heaven did not wait for the evidence to catch up before it spoke. God speaks in line with the destiny, not the diagnosis — He calls into being the things that are not, so that they may be.

This is not a trick reserved for the Almighty; it is the family way of working, and it reappears in the Son. Jesus spoke to a storm and it lay down like a scolded dog. He spoke to a fig tree and it withered from the roots. He spoke into a tomb — “Lazarus, come out” — and a four-day corpse walked into the sunlight (John 11:43). Notice what He never did: He never merely described a situation. He addressed it.

You were made in the image of this speaking God and redeemed by His speaking Son, which means your words were never designed to be idle commentary on your life. They were designed to shape it. Most of us have been narrating our circumstances like a helpless spectator in the stands, when the Father is inviting us onto the field. Today, catch yourself the next time you start to describe a hard thing — and instead of reporting it, try addressing it in line with what God has said.

It is time your mouth joined the family business.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Do your words mostly describe your situations, or do they address them?

— What has God already "named" over your life that your mouth has not yet agreed with?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, You call things that are not as though they already were, and every storm knew the voice of Your Son. Teach my tongue the family language. I am done narrating my life from the stands — put me on the field, and let my words carry Your intentions. Amen.

_May your mouth learn this week the language your Father has always spoken._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 4:16–21; Genesis 1; Mark 4:39$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Proverbs 18:21', $dev$“The tongue has the power of life and death, and those who love it will eat its fruit.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$If you knew that every word leaving your mouth was a seed dropping into soil, would you speak the way you spoke yesterday? Because that is exactly what Solomon says is happening. Words are seeds, and seeds do not evaporate — they grow, they mature, and one day they arrive on your table as fruit you have to eat.

Read the second half of the verse slowly: “those who love it will eat its fruit.” There is a harvest attached to your speech, and the harvest is not random. It corresponds to what was planted. You are eating today — in your mood, your momentum, your sense of what is possible — the fruit of sentences you scattered last season, most of them without thinking.

This is where honesty has to enter. Listen to how we plant. “I'm always broke.” “Nothing ever works out for me.” “I can't.” We say these things as if we are simply reporting the weather, but heaven's soil does not distinguish between a complaint and a command — it just grows what it is given. You cannot talk defeat and expect victory; you cannot sow the language of lack and reap a harvest of abundance. If a man keeps a poor mouth, life eventually hands him a poor life to match it. The law is not cruel; it is simply consistent.

And consistency is the good news, because the same law runs gloriously in reverse. The tongue that has power to kill has equal power to give life. Start speaking words of victory over your health, your family, your work — not as denial of the facts, but as seeds sown toward a future harvest. Plant the seed of victory, and in due season you shall eat its fruit. Your tongue is not a broadcasting station for your feelings; it is a farming implement.

So before the day gets loud, choose your seed bag. You will eat whatever you plant.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What fruit currently on your table can you honestly trace back to your own repeated words?

— What three "victory seeds" will you begin planting with your mouth every day?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I take responsibility for what I have been planting. I empty the seed bag of defeat, complaint, and lack, and I fill my mouth instead with words of life. Give me the patience to keep sowing until the harvest comes, and let it be a harvest worth eating. Amen.

_May your next harvest prove that your seed changed._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 18:20–21; 12:14$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'James 3:2', $dev$“For we all stumble in many ways. Anyone who is never at fault in what they say is perfect, able to keep their whole body in check.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Imagine a stranger followed you for one week with a notebook, wrote down every sentence you spoke about yourself, and then read it back to you as a prophecy. Would you want that future? For most of us, the honest answer is unsettling — and it exposes something we would rather not admit: whether we realize it or not, we are prophesying our own lives.

James makes an enormous claim in today's verse. The person who could master what they say could master everything — “keep their whole body in check.” Why does the mouth carry that much weight? Because your life quietly organizes itself around your words. Speech is not the caboose of your life, dragged along behind everything else; it is closer to the engine.

Watch how it works. The man who keeps saying, “I always fail interviews,” walks into the room already wearing that verdict on his face and in his posture; the body obeys the sentence the mouth keeps repeating, and he stumbles into the very outcome he predicted. The world calls this a self-fulfilling expectation and treats it as a clever discovery. Scripture knew it first and located its root deeper still: “the mouth speaks what the heart is full of” (Luke 6:45). Your saying reveals your believing — and then your believing, once spoken, steers your becoming.

So the correction cannot start where we usually aim it. We keep trying to fix the circumstances while leaving the prophecy untouched. But if your words are the engine, then changing your life begins at the microphone. Conduct an audit today. Which recurring sentence about yourself would you be alarmed to see fulfilled? Find it, name it, and strike it from your record.

Your future is listening to your mouth. Give it something worth becoming.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— What did you prophesy over yourself this week, sentence by sentence — and would you want it fulfilled?

— Which recurring phrase must be struck from your record starting today?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, forgive the false prophecies I have spoken over my own head — the verdicts I repeated until I believed them. From today, let my mouth agree only with the future You have written for me, and let my words become a prophecy I would be glad to see come true. Amen.

_May every sentence you speak this week be one you would gladly see fulfilled._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$James 3:1–2; Luke 6:43–45$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'James 3:4', $dev$“Take ships as an example. Although they are so large and are driven by strong winds, they are steered by a very small rudder wherever the pilot wants to go.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Picture a great cargo ship — thousands of tons of steel, shoved along by a gale it did not choose. And now picture the thing that decides where all that weight ends up: a rudder small enough that a single person can turn it. James is genuinely amazed at that ratio, and he wants us to be amazed too, because he is about to say your tongue is exactly that rudder for your life.

Read this as good news, not as a threat. The ship is enormous; the rudder is tiny — and that means you do not have to wrestle your whole overwhelming life into a new direction all at once. You do not have to shove the hull around by hand. You need to gain the rudder. Change the persistent words, and the vessel begins, one patient degree at a time, to come around.

But the verse contains a warning tucked inside the comfort: a rudder is never neutral. It is steering you somewhere every single day, whether or not you are paying attention to it. The same small muscle that can guide a ship into safe harbor can, left to drift, guide it straight into the rocks. The undirected tongue does not simply idle — it steers toward the storm, muttering the fears and complaints that set a course you never consciously chose.

So take the helm on purpose. Do not leave the rudder to run itself. Set your course by the Word of God — decide where God has said your life is headed — and then speak that course out loud, deliberately, morning by morning. The turn will feel small. That is how a ship turns: not in one dramatic swing, but degree upon degree, until one day you look up and the harbor is dead ahead.

Grab the rudder today. Something so small is steering something so large.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Toward what harbor are your current words steering your life — honestly?

— What one course-setting sentence will you speak deliberately each morning this week?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Lord, I take the rudder today instead of letting it drift. I set my course by Your Word, and I will hold that course with my words — degree by degree, past the rocks and into the harbor You have named for me. Amen.

_May your small rudder steer your great ship into God's safe harbor._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$James 3:3–6; Psalm 141:3$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Proverbs 6:2', $dev$“You are snared by the words of your mouth; you are caught by the words of your mouth.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Sometimes the enemy does not have to lift a finger to defeat us. We do the work for him, sentence by sentence, and then wonder who tied the knots. Solomon names the trap with unnerving precision: you are snared — not by your circumstances, not by other people — by the words of your own mouth.

Listen to how a snare is built, one strand at a time. “I could never lead.” “I'm just not the marrying type.” “My family has always been poor, that's how it is.” Each of these feels like a modest, even humble, statement of fact. But each one is a knot. Tie enough of them and you have a net, and a person can spend years inside a net they wove with their own tongue, quietly convinced someone else put them there.

The trap works because it is a chain, and the chain is subtle. Spoken limits become believed limits. Believed limits become attempted limits — you stop reaching for the thing you have already declared impossible. And attempted limits, over time, simply become your life. No one imprisoned you. You testified against your own future, and your future, being fair, accepted the testimony.

But here is the mercy hidden in the same verse: what words tied, words can untie. A snare made of sentences can be cut by better sentences spoken under a stronger authority. So do not vaguely resolve to be more positive today — do something specific. Name the sentence that has held you longest. Renounce it out loud. Then replace it out loud with the Word of God: “I withdraw the words ‘I could never’ — I declare instead, I can do all things through Christ who strengthens me” (Philippians 4:13).

The mouth that tied the knot is fully able to untie it — as long as it submits to a Word stronger than its own.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which self-spoken sentence has snared you the longest?

— Write out its revocation and its scripture replacement — then say both aloud today.$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I revoke every sentence I have spoken against my own destiny — every knot my tongue has quietly tied. In the name of Jesus the snare is cut, and from now on my mouth testifies for me and not against me. Amen.

_May every knot your words ever tied come loose today._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 6:2; Matthew 12:36–37$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '1 Thessalonians 1:3', $dev$“We continually remember before our God and Father your work produced by faith, your labor prompted by love, and your endurance inspired by hope in our Lord Jesus Christ.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$There is an argument going on inside you most of the day, and you are the deciding vote. Two voices are contending for your attention: the voice of faith and the voice of defeat. Both are articulate. Both hand you a script all day long. And whichever script your mouth reads aloud is the one that gains power in your life.

The voice of defeat has one great advantage — it is fluent in facts. It quotes the bank balance, recites the diagnosis, replays the history in exact detail, and dares you to argue. And here is the subtlety we miss: what it says is often true. It really is a fact. But a fact is not the same thing as the truth. You can be holding every fact of a matter in your hand while the whole truth of it still sits with God, waiting to be revealed. The fact was that Lazarus was cold and four days dead. The truth was that Jesus was already on the road, and the tomb was about to lose (John 11:17, 43).

That is the crucial distinction. The voice of faith does not pretend the facts away — it does not deny that the grave is real. It simply outranks the facts, the way a king's signed decree outranks a loud rumor in the marketplace. Faith lets the fact be a fact, and then speaks a higher word over it.

So the battle is not really about whether hard facts exist; they do. The battle is about which script gets read into the microphone of your mouth. Tomorrow both voices will show up again — count on it. The defeat script will arrive first and read most fluently. When it does, pause. Do not read it aloud out of habit. Deliberately turn the page to faith and read that one instead.

The direction of your future is decided at the microphone. Choose carefully who gets to speak.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Which voice has been getting your microphone at the end of the day?

— Name one "fact" in your life that God's truth outranks — then say the truth aloud.$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, today I hand the microphone to the voice of faith. Let the facts inform me without commanding me, and let only Your truth be quoted by my lips. When both scripts arrive, give me the presence of mind to read Yours aloud. Amen.

_May the voice of faith win every argument held in your mouth this week._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Numbers 13:30–14:9; 2 Corinthians 4:13$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Luke 6:45', $dev$“A good man brings good things out of the good stored up in his heart… For the mouth speaks what the heart is full of.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$For six days we have worked on the mouth. Today Jesus tells us there is a limit to how far you can get by managing the mouth alone — and He points past the lips to the source. The mouth, He says, is only a bucket. It draws from a deeper well: the heart. And whatever fills the well is what comes up in the bucket.

This is why willpower over your words eventually cracks. You can guard your speech beautifully on a calm day. But squeeze the bucket — put a person under real pressure, real hurt, real fear — and whatever was actually filling the well is exactly what spills out. Your words in a crisis are not an accident and they are not the "real you" betraying you; they are your heart taking an honest exam. The reaction that escapes you when life presses hard is a reading of what you were truly full of all along.

That reframes the whole project. The ability to keep a level head and speak sound words under fire is not a personality trait some people are lucky to have — it is the visible sign of maturity being formed on the inside. And maturity of the mouth is grown by filling the well, not by clenching the bucket harder.

So the deepest speech therapy turns out to be well-filling. Read the Scriptures aloud until they get into you. Sit under worship in the house of God. Rehearse the testimonies of what He has already done. Practice thanksgiving on the ordinary days so it is available on the hard ones. Do this steadily for thirty days, filling the well with life, and then simply listen to what starts spilling the next time pressure squeezes you.

Change the spring, and you change every stream that flows from it.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— What spilled out of you the last time life squeezed hard — and what does it reveal about your well?

— What will you deliberately pour into the well, every day, for the next thirty days?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord, work below my words. It is not enough to guard my mouth — fill the well of my heart with Your Word and Your praise, until even my under-pressure sentences taste of life. Grow the maturity in me that keeps sound words when the squeeze comes. Amen.

_May your well be so full of life that pressure can only make you overflow._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 6:43–45; Colossians 3:16$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Psalm 103:20', $dev$“Praise the Lord, you his angels, you mighty ones who do his bidding, who obey his word.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Here is a detail that should change how you feel every time you open your Bible to quote it. According to today's verse, the angels — beings who “excel in strength” — are listening, and they move at a specific signal. Read what triggers them: not our complaints, not our anxious commentary, not even our sincere venting. They move at His word. Wherever God's word is being spoken, heaven's mighty ones recognize it and go to work.

This is what quietly separates speaking Scripture from speaking positivity. Positive words are a real and good gift — they lift your mood, steady your nerves, improve your psychology, and there is no shame in that. But positive thinking works on you. The Word of God, spoken, works on heaven. “He sent out his word and healed them” (Psalm 107:20). “My word... will not return to me empty, but will accomplish what I desire” (Isaiah 55:11). When you speak what God has said, you are not just encouraging yourself — you are releasing something with its own guaranteed outcome.

So the invitation today is to stop discussing your situations and start addressing them — with His actual words. You have a family member whose future worries you; you have a body that needs healing; you have work and a destiny stalled at some wall. You have talked about these things to God endlessly, and that is right. But have you ever taken His Word and spoken it directly to the mountain, in His name?

Do not merely tell God about the obstacle. Find the verse that fits, and speak that verse over the situation — morning and night, out loud, in the name of Jesus. When your mouth carries His sentences, unseen servants recognize the signature and get to work on your behalf.

Your voice, quoting His Word, is louder in heaven than you have ever imagined.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which situation have you discussed endlessly but never once addressed with Scripture spoken aloud?

— Find one verse for it today, and speak it over the situation morning and night.$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, put Your Word in my mouth for every battle I am facing. Teach me to stop merely reporting my troubles and to start speaking Your sentences over them. As I say what You have said, let heaven's mighty ones recognize the signature and move. Amen.

_May your quoted verses be recognized in realms your eyes cannot see._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 103:20; Isaiah 55:10–11; Acts 20:32$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Mark 11:23', $dev$“Truly I tell you, if anyone says to this mountain, ‘Go, throw yourself into the sea,’ and does not doubt in their heart but believes that what they say will happen, it will be done for them.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Read today's verse slowly and notice what Jesus did not say. He did not say, “pray about this mountain.” He did not say, “ask God to remove this mountain.” He said, “whoever says to this mountain” — speech, aimed straight at the obstacle, loaded with faith. That is not a slip of language. Jesus is drawing a line most believers have never seen.

Prayer and declaration are not the same thing, and the mature believer needs both. Prayer petitions God — it lifts the matter upward and asks the Father to act. Declaration addresses the problem — it turns and speaks directly to the mountain in the authority God has given. We are fluent in the first and often completely silent in the second. We spend years telling God about the mountain and never once speak a word to the mountain.

Look again at the ratio inside the verse. There is one “believes in his heart,” but the word says appears with the mountain, with the command, with the promise. Faith belongs in the heart, yes — but it was designed to be issued through the mouth. Many believers are carrying real faith locked away in their hearts that has never in their lives been deployed through their lips. It is an army that has never left the barracks, a weapon that has never been drawn.

So do the specific work today. Identify your mountain — the obstacle itself, not the difficult people standing near it, not the circumstances around it, but the thing blocking the road. Then speak to it by name, in the name of Jesus, with the Word of God backing your voice. That mountain has been listening to your fear and your complaint for years.

Let it finally hear your faith.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you been talking about your mountain, or actually talking to it?

— Write the exact sentence of command you will speak to it — then speak it aloud.$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I believe in my heart — and now I will also say with my mouth. To every mountain standing between me and the life You have written for me: move, in Jesus' name. I will not doubt in my heart, and I will not be silent with my mouth. Amen.

_May the mountains that heard your fear now hear your faith — and move._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 11:20–24; Zechariah 4:6–7$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Isaiah 49:2', $dev$“He made my mouth like a sharpened sword, in the shadow of his hand he hid me; he made me into a polished arrow and concealed me in his quiver.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Here is the image God leaves you with on the last day: He fashions servants whose mouths are sharpened swords and polished arrows. Not blunt instruments. Not decorative ones. Words with an edge, a direction, and an appointed target. These ten days of training were never for decoration — heaven arms the mouths it can trust, and you have been in the armory.

But a blade this sharp needs one final safeguard, and James supplies it exactly here: “Out of the same mouth come praise and cursing. My brothers and sisters, this should not be” (James 3:9–10). The same tongue you have been sharpening to bless can, in an unguarded moment, be turned to wound. The mouth that blesses God must not curse those made in His image — and that includes the person you meet in the mirror every morning. A weapon that cuts in both directions endangers its own bearer.

So point the sword the right way. Deliberately speak blessing over your children — call out their futures by name. Speak life over your spouse, honor over your colleagues, mercy over yourself. Prophesy good over people, not evil; become someone whose words leave others more alive than they were before you spoke.

And then go. Carry the family language on your lips into everything that is left of your life: “I believed; therefore I have spoken” (2 Corinthians 4:13). Speak life at home. Speak life over your work. Speak life into your body and toward the destiny written in your book. When the moment is quiet, stay hidden in the quiver, kept in the shadow of His hand — ready, sharpened, and waiting for the moment God draws you and aims.

You came in a spectator. You leave an arrow. Now speak life, all your days.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Over whom will you deliberately speak blessing this week — by name?

— What daily declaration set will you carry out of this plan and keep for life?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, make my mouth a sharpened sword in Your hand — never turned against Your children, always drawn for Your purposes. Guard me from cursing what You have blessed, including myself. I will speak life over every day that is written in my book. Amen.

_May your words be swords in God's hand and springs in people's deserts — all your days._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 49:1–3; James 3:9–12; Numbers 6:24–26$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
