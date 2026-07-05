-- Reseed fear-not with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'fear-not');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'John 14:27', 'The Gift Has Already Been Given'),
  (2, 'Isaiah 41:10', 'The Most Repeated Command'),
  (3, '2 Timothy 1:7', 'Fear Is a Visitor, Not a Landlord'),
  (4, 'Mark 4:38–39', 'The Storm and the Pillow'),
  (5, 'Philippians 4:6–7', 'Trade Your Worry for Worship'),
  (6, '1 Peter 5:7', 'Cast It — and Leave It There'),
  (7, 'Matthew 6:26', 'The Sparrow Ledger'),
  (8, 'Proverbs 29:25', 'Free From the Fear of Faces'),
  (9, '1 John 4:18', 'The Love That Evicts Fear'),
  (10, 'Matthew 14:29–30', 'Eyes on Him, Feet on Water')
) AS v(n, ref, title) WHERE p.code = 'fear-not';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'fear-not'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'John 14:27', $dev$“Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Read the verse again and notice the tense. Jesus does not say, "Peace I will send you when things calm down." He says, "Peace I leave with you" — the language a dying man uses when he writes a will. This is an inheritance, already signed, already yours. The night He spoke these words He was hours from betrayal, arrest, and a cross, and He was handing out peace like a man with more than enough to spare.

Sit for a moment with the setting. The upper room was thick with dread. The disciples could feel that something was ending, and Jesus, instead of borrowing their panic, gives them the very thing their hearts were losing. This is the peace that would sleep through a storm on the lake, stand silent before Pilate, and walk to Calvary without flinching. That is the peace with your name on the envelope.

Here is what makes it different: "I do not give to you as the world gives." The world's peace is conditional — peace if the diagnosis is clear, peace if the account is full, peace if the people around you approve. It rises and falls with your circumstances because it is built on them. Christ's peace is anchored somewhere your circumstances cannot reach: in His finished work. Jesus said elsewhere, "In me you may have peace. In this world you will have trouble" (John 16:33) — notice, peace in Him, not in the absence of trouble.

So this whole journey does not begin with you working harder to feel calm. It begins with you unpacking a gift already delivered. Much of the anxiety we carry is simply an inheritance left in the box, unopened. You are not trying to manufacture peace today; you are learning to receive what has been given.

Stop striving to earn the calm that Christ has already willed to you. Simply open the box.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What condition has your peace been waiting for — "I will finally rest when…"?

— What would today actually look like if you treated Christ's peace as already yours rather than something to be earned?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I receive the peace You left for me. I stop waiting for conditions and I start unpacking the inheritance. Quiet my heart with what You have already finished, and let Your calm reach the anxious corners I have kept in the dark. Amen.

_May the peace of Christ stand guard over your heart and mind today._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$John 14:25–27; Isaiah 9:6$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Isaiah 41:10', $dev$“So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Someone once counted the commands of God and found that the one He repeats most is not about holiness, or giving, or even love. It is "fear not." Some form of it appears again and again across the Scriptures — spoken to shepherds on a hillside, to prophets in danger, to fishermen in a boat, to a young woman visited by an angel. Over and over, the first word from heaven is the same: do not be afraid.

Why would God say it so often? Because He knows your frame. He remembers that you are dust (Psalm 103:14). Your Father is not surprised by your anxiety, nor offended by it; He anticipated it, the way a parent packs extra food for a long journey knowing the child will grow hungry along the way. The sheer repetition is not divine impatience — it is divine tenderness. He keeps saying it because He knows how often you will need to hear it.

Now look closely at the reason God attaches to the command here. He does not say, "Do not fear, for the danger is small." He does not say, "Do not fear, for I will remove every threat." He says, "Do not fear, for I am with you." Heaven's answer to fear has never been better circumstances; it has always been closer company. The same promise runs like a thread through Scripture — "I will never leave you nor forsake you" (Deuteronomy 31:8) — and it is the whole ground of our courage.

Bring this down to tonight. When fear wakes you at 2 a.m. and starts reciting everything that could go wrong, you do not have to argue it into silence with better circumstances you cannot yet see. You answer it with a Person: "I am not alone. I am with You, and You are with me." Often what we are truly asking God for is a fixed situation, when what He is offering is a nearer Presence.

Your fear is asking for a change of scenery. God is offering you Himself — and He is enough.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— When fear speaks tonight, what specific "for I am with you" truth will you answer it with?

— Where have you been begging God for better circumstances when He has been offering you closer company?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, thank You that You never tire of telling me not to fear. Teach my heart the reason behind the command: You are with me. Strengthen me, help me, uphold me with Your righteous right hand today, and let Your nearness be more real to me than my fear. Amen.

_May you feel the nearness of God in the very place you used to feel most alone._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 41:8–13; Deuteronomy 31:8$dev$),
  (3, 1, 'scripture', 'Today''s Reading', '2 Timothy 1:7', $dev$“For God has not given us a spirit of fear, but of power and of love and of a sound mind.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Fear, in itself, is not sin. It is an alarm system, wired into you by God, meant to fire for a moment and protect you from real danger — the jerk of your hand from a flame, the quickened pulse before a genuine threat. The alarm was never the problem. The problem begins when the alarm never switches off; when a signal meant to sound for seconds is left ringing through the whole house, day and night.

That is the difference between fear and anxiety. Fear is a visitor at the door; anxiety is fear that has signed a lease and moved into the master bedroom. And here Paul writes to a young, timid pastor named Timothy — a man clearly tempted to shrink back — and hands him the truth that evicts the tenant: "God has not given us a spirit of fear." Whatever that resident spirit of dread is, trace its origin honestly, and you will find it did not come from your Father's hand.

Look at what He did give: "power and love and a sound mind." A sound mind is a mind that can be gathered, ordered, quieted — not a mind at the mercy of every racing thought. This is why Scripture can command us to take "every thought captive to obey Christ" (2 Corinthians 10:5); a captive thought is one you are no longer forced to obey. You are permitted to feel the alarm. You are not obligated to house the tenant it announces.

So begin, today, to name fear accurately. When the dread rises, do not treat it as the landlord of your life, entitled to every room and every decision. Treat it as what it is: a visitor overstaying a welcome it was never granted. You do not negotiate the terms of a lease you never signed. You show it the door.

The alarm may ring — but you hold the deed to the house, and fear was never given the keys.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Which fear has quietly moved from visitor to landlord, deciding your choices from the master bedroom of your heart?

— What changes for you today to know that the spirit of fear you have been carrying was never given to you by God?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, I receive what You have given me — power, love, and a sound mind — and I release what You never gave. Fear, you are a visitor and not the landlord; in the name of Jesus, the lease is cancelled and the keys are Yours, Lord. Amen.

_May every fear that outstayed its welcome leave your house today._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$2 Timothy 1:6–10; Romans 8:15$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Mark 4:38–39', $dev$“Jesus was in the stern, sleeping on a cushion. The disciples woke him and said to him, “Teacher, don’t you care if we drown?” He got up, rebuked the wind and said to the waves, “Quiet! Be still!”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Picture the scene precisely. One boat, one storm, one stretch of violent water — and two entirely different responses inside the same hull. Twelve seasoned men, some of them lifelong fishermen, are bailing water and shouting into the wind, certain they are about to drown. And in the stern, on a cushion, one Man is fast asleep. Same boat. Same waves. Opposite peace.

The difference was not information. Jesus was not asleep because He was unaware of the storm; He had crossed enough water to know exactly how dangerous the Sea of Galilee could turn. The difference was authority. The disciples saw the size of the waves; Jesus knew who the waves answered to. When they finally wake Him with the accusation that stings — "Don't you care if we drown?" — He does not first defend His love. He stands, and He speaks to the sea as a master speaks to a servant: "Quiet! Be still!" And it obeys.

Here is what those men learned that night, and what this whole plan is trying to teach your heart: peace is not the absence of a storm. Peace is the presence of a Person in your boat. The psalmist knew it long before — "God is our refuge and strength, an ever-present help in trouble… Be still, and know that I am God" (Psalm 46:1, 10). The stillness is not something you summon by clenching your jaw. It is something you receive by remembering who is aboard.

So look honestly at the storm you are in — the health scare, the strained marriage, the finances that will not add up — and ask where you have placed Jesus in the picture. Panicking as though the boat were empty? Or resting as though the Lord of the wind were asleep three feet away? The same voice that silenced the sea knows how to say "Quiet, be still" to a racing mind. You do not need the storm to end before you can rest.

You do not need the wind to stop; you need only remember who is in the boat.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— What storm are you in right now — and where, honestly, is Jesus in your picture of it?

— What would "sleeping on the cushion" look like in your actual situation this week?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You are in my boat, and that changes everything about the boat. Speak over my wind and my waves — and speak over my racing mind — the word You spoke that night: Quiet. Be still. I will rest in Your presence before I ever see calm water. Amen.

_May you rest tonight like someone who knows exactly who is in the boat._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 4:35–41; Psalm 46:1–3, 10$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Philippians 4:6–7', $dev$“Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God… will guard your hearts and your minds in Christ Jesus.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Before you brush past this command as too high — "do not be anxious about anything" — remember where the pen was when it wrote these words. Paul was in a prison cell, chained, with his own execution a real possibility. This is not the advice of a man whose life was easy. It is the testimony of a man who had found something that worked in the worst of places.

Notice, too, that Paul does not simply tell anxiety to stop. He tells it where to go. Anxiety is not merely to be resisted; it is to be redirected. Every worry churning in you is, at heart, a prayer request wearing the wrong clothes. The instruction is not "stop thinking about the thing." It is "in every situation… present your requests to God." You take the exact concern that was spinning as worry and you hand it, item by item, to your Father.

And do not miss the small phrase that carries the whole weight: "with thanksgiving." Worry is a rehearsal — it plays, over and over, everything that could still go wrong. Thanksgiving is a different rehearsal — it recites everything God has already done right. The two cannot occupy the same breath, which is precisely why heaven prescribes them together. Gratitude is not denial of the trouble; it is memory of the Deliverer, and memory is what steadies a frightened heart.

Then comes the promise, and it is stronger than we usually hear. The peace of God will "guard" your heart and mind — the word is a military one, a sentry posted at the gate. You are not told to stand watch over your own heart all night; that is a losing battle. God's peace takes the post. It stands at the door of your mind and inspects every thought that seeks to enter, turning away the ones that have no papers.

Hand over the requests, offer the thanks, and let a peace you cannot explain stand guard where you used to stand and worry.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Take your loudest worry: what does it sound like re-dressed as a specific request offered with thanksgiving?

— What five things can you thank God for out loud, right now, before you pray about anything else?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I bring You my worries dressed now as requests, one by one. Thank You for every past faithfulness — I name them before You now instead of rehearsing my fears. Post Your peace as a guard at the door of my mind today, and turn away every thought that has no place. Amen.

_May the peace that passes understanding garrison your heart and mind today._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 4:4–9$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '1 Peter 5:7', $dev$“Cast all your anxiety on him because he cares for you.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Peter chose his words with a fisherman's hands. "Cast" is a net-thrower's word — it means to hurl something decisively away from yourself, the way a net leaves the hand and lands somewhere it can no longer be reached. It does not mean to dangle your anxiety over the water while keeping a firm grip on the rope. It means release, full-armed and final.

If we are honest, most of us do not struggle to pray about our worries. We struggle to leave them where we prayed them. We bring the burden to God, set it down at the altar, say amen — and then pick it right back up on our way out the door. We are like a traveler who checks a heavy bag at the counter and then insists on carrying it onto the plane anyway. The prayer was real; the release was not.

Look at the reason Peter attaches, because everything hinges on it. He does not say, "Cast your anxiety on Him because you are strong enough to let go." He says, "because he cares for you." The ground of the casting is not your willpower; it is His affection. You are not throwing your cares into a void, or onto a God too busy to notice. You are handing them to a Father whose eye is on you, whose heart is toward you. David learned the same rhythm: "Cast your burden on the Lord, and he will sustain you" (Psalm 55:22).

So make the release real today. Give it a shape your body can remember — write the worry on paper and physically hand it over, or speak it aloud and then open your hands, palms up, as a sign that you are no longer holding it. And when your fingers instinctively curl back around the old weight, as they will, do not despair. Simply remind yourself of the reason: you can put it down, because you yourself are being carried.

Cast it like a net — arm fully extended, grip fully open — and walk away lighter, because the One who catches it never lets you fall.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Which anxiety have you prayed about many times but never actually released — quietly picking it back up on the way out?

— What ritual of release could help you make the casting real: writing it down, speaking it out, opening your hands?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, today I will not dangle my anxiety over the water — I cast it. Take the full weight of the thing I have carried far too long. And when my hands reach for it again out of habit, remind me of the reason I can let go: I am carried by You, because You care for me. Amen.

_May your shoulders forget the shape of the burden you finally cast today._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$1 Peter 5:6–11; Psalm 55:22$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Matthew 6:26', $dev$“Look at the birds of the air; they do not sow or reap or store away in barns, and yet your heavenly Father feeds them. Are you not much more valuable than they?”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$When Jesus wanted to treat financial anxiety, He did not hand out a budget. He pointed at birds. "Look at the birds of the air." It is worth remembering who was listening: not a comfortable crowd with full pantries, but ordinary people who knew what an empty stomach felt like. He was not dismissing the reality of need. He was pointing to a different way of keeping accounts.

Birds keep a peculiar ledger. They do not sow, reap, or store away in barns; they have no savings, no warehouse, no five-year plan. They simply receive today's provision today — and, Jesus implies, they sing anyway. There is no bird pacing the branch at midnight over next winter. And then He asks the question that quietly resets everything: "Are you not much more valuable than they?"

That question is the heart of it, because anxiety about provision is, underneath, a question about your worth to the Provider. When we panic over supply, we are really asking, "Does He value me enough to take care of me?" And heaven has already answered that question — not in words, but in blood. "He who did not spare his own Son… how will he not also… graciously give us all things?" (Romans 8:32). A Father who gave you the Son will not forget the smaller matters.

Notice, too, the timeframe Jesus prescribes: "do not worry about tomorrow" (Matthew 6:34). God distributes grace like manna in the wilderness — enough for one day, gathered fresh each morning, impossible to hoard (Exodus 16:4). Most of our fear lives in tomorrow, borrowing troubles that have not yet arrived and may never come. Today's grace was measured out for today's needs. Tomorrow's grace is already on the calendar, and it will meet you exactly when tomorrow does.

So look at the birds, and let them preach: your Father feeds them, and He values you far more — receive today's bread, and sing on the branch while you wait for tomorrow's.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Is your anxiety mostly about today's real needs — or about tomorrows that have not yet arrived?

— What is today's bread — the actual provision already in your hands for this actual day?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, feed me today the way You feed the birds, and teach me to sing on the branch while I wait. I refuse to borrow tomorrow's troubles; I trust You for tomorrow, and I will meet its grace when I meet its needs. Thank You that I am precious to You. Amen.

_May you find today's table already set, and tomorrow's already planned._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 6:25–34; Exodus 16:4$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Proverbs 29:25', $dev$“Fear of man will prove to be a snare, but whoever trusts in the Lord is kept safe.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Not every fear comes with claws and darkness. Some fear wears a face you know well: the parent you can never quite please, the crowd you dress and perform for, the circle of opinions you consult before you dare to obey God. It rarely feels like fear at all — it feels like tact, or humility, or simply keeping the peace. But Scripture gives it a plainer name: the fear of man. And it calls it a snare — a hidden trap that catches not just moods, but destinies.

A snare is subtle by design. It does not announce itself; it lets you walk right into it. The fear of man works the same way, tightening one small compromise at a time — a truth left unspoken, an obedience delayed, a conviction quietly filed away because someone might disapprove. John records the tragedy in one line: many leaders "believed in him," but "because of the Pharisees they would not openly acknowledge their faith, for they loved praise from men more than praise from God" (John 12:42–43). The snare did not steal their belief; it stole their obedience.

Freedom here is not learning to stop caring about people — love still cares. Freedom is learning to stop being ruled by them. And the deliverance is beautifully simple: one holy fear displaces a thousand small ones. When the opinion of God becomes the loudest voice in the room, every other verdict shrinks to its proper size — information, perhaps, but no longer your identity. Paul understood the stakes exactly: "If I were still trying to please man, I would not be a servant of Christ" (Galatians 1:10).

So bring your fear of faces into the light and let it lose its grip. The becoming life — the person God is forming you into — cannot be lived on the shifting approval of spectators. You were made for an Audience of One, and here is the astonishing part: He is not withholding His approval, waiting for you to perform well enough. He is already pleased with the person He is making you to be in Christ.

Unhook your worth from the verdict of the crowd, and live before the only Face whose smile can never be earned and never be lost.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Whose disapproval do you fear most — and what has that fear already cost you?

— What obedience have you delayed, softened, or hidden because of a particular face?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, unhook my heart from the verdicts of people. Let Your voice be the loudest in my life and Your pleasure be my prize. I lay down the exhausting work of managing every opinion and I choose the safety of simply trusting You. Amen.

_May the only face you live to please be the One that shines upon you._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 29:25; Galatians 1:10; John 12:42–43$dev$),
  (9, 1, 'scripture', 'Today''s Reading', '1 John 4:18', $dev$“There is no fear in love. But perfect love drives out fear, because fear has to do with punishment.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$This is the deepest surgery of the whole plan, so let the knife go where it needs to go. Beneath most chronic fear, underneath the surface worries about money and health and people, there lies one buried question, rarely spoken aloud: Am I truly safe with God? Not safe from the storms of life — safe with Him. Is He, deep down, for me or against me?

John puts his finger on exactly why fear festers there: "fear has to do with punishment." Fear thrives wherever we secretly suspect that the rod is still coming — that we are one failure away from being cast out, that God's affection is probationary and could be revoked on our next bad day. As long as that suspicion lives unchallenged, no amount of positive thinking will quiet the alarm, because the alarm is guarding a wound.

And here is the cure, the only cure strong enough: "perfect love drives out fear." At the cross, the punishment question — the one your fear keeps circling back to — was settled once and for all. "The punishment that brought us peace was on him, and by his wounds we are healed" (Isaiah 53:5). Every ounce of judgment your sin deserved fell on Jesus, so that not one drop remains for you. You are not one mistake away from rejection; you are one Savior away from it — forever. Paul asks the triumphant question and leaves it hanging in glory: "If God is for us, who can be against us?" (Romans 8:31).

So loved people fear less. Not because their circumstances suddenly improve, but because their foundation does. When you know — bone-deep, settled, past the reach of a bad night — that you are loved and safe and no longer under condemnation, the old alarm system finally has nothing left to guard. Let His perfect love go deeper today than your fear has ever reached.

Let love, not fear, have the final word in the oldest room of your heart — and watch fear pack its bags.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Do you secretly relate to God as a probation officer waiting for you to slip, or as a Father who is for you?

— Where would fear lose its grip if you were certain — bone-deep — that you are fully loved and forever safe with Him?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, let Your perfect love reach the oldest room in my heart, the one where my deepest fear still lives. Settle the punishment question in me forever at the cross — remind me that it all fell on Jesus. Love me until I am brave. Amen.

_May perfect love walk through your heart today and turn every fear out of doors._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$1 John 4:16–19; Romans 8:31–39$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Matthew 14:29–30', $dev$“Come,” he said. Then Peter got down out of the boat, walked on the water and came toward Jesus. But when he saw the wind, he was afraid…”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Before we call this a story about sinking, remember what Peter actually did: he walked on water. A fisherman — a man who had spent his life on top of that sea in a boat — stepped over the side and stood on the waves themselves. We tend to rush to the failure, but do not miss the miracle. And Peter managed the impossible for exactly as long as one thing stayed true: his eyes were on Christ.

Read the moment his footing failed, because it is precise. "When he saw the wind, he was afraid, and beginning to sink." He did not go under when the storm grew stronger; the wind had been howling the whole time. He went under when his attention changed address — the instant his gaze moved from the face of Jesus to the fury of the weather. The waves did not defeat him. A shift of focus did.

This is your commissioning at the end of these ten days. The life God is calling you into will keep summoning you out of safe boats and onto unlikely water, and the wind will never stop auditioning for your attention. Fear, in the end, is not conquered by studying the waves more carefully; it is conquered by a fixed gaze. Hebrews names the discipline exactly: "fixing our eyes on Jesus, the pioneer and perfecter of faith" (Hebrews 12:2). Where you look is where you will walk.

And even Peter's sinking preaches good news, so hear it before you step out. The moment he cried, "Lord, save me!" the text says "immediately Jesus reached out his hand and caught him." Not after a lecture, not after a probation — immediately. This is the gospel under your feet: your worst day of faith still ends inside His grip. He will not let the wind have you.

So take everything these ten days have given you and go walk. Keep your eyes on Him, step out when He says "Come," and trust that even when you sink, the hand that made the sea will catch you before you ever hit the bottom.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Where is Jesus saying "Come" to you right now — and what wind keeps stealing your gaze off His face?

— Which single practice from these ten days will you carry with you for life?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I step out of the boat. When the wind shouts for my attention, fix my eyes back on You; and when I sink, catch me immediately as You caught Peter. I choose a life of walking toward You — whatever the water does under my feet. Amen.

_May you live the rest of your days with your eyes on Him — and may every storm beneath your feet become a floor._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 14:22–33; Hebrews 12:1–3$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
