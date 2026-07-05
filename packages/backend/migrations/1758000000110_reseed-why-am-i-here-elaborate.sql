-- Reseed why-am-i-here with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'why-am-i-here');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'John 18:37', 'The Man Who Knew Why'),
  (2, 'Isaiah 43:6–7', 'Made for His Glory'),
  (3, 'Jeremiah 1:5', 'Sent, Not Dropped'),
  (4, 'Colossians 3:23', 'Your Work Is a Sanctuary'),
  (5, 'Nehemiah 1:3–4', 'Follow Your Holy Burden'),
  (6, 'Nehemiah 2:8', 'The Three Ps of Purpose'),
  (7, 'Ecclesiastes 3:1', 'Don''t Eat Your Dinner in the Morning'),
  (8, 'Mark 10:45', 'Purpose Is Discovered on Your Knees — Serving'),
  (9, 'Psalm 138:8', 'Praise Finds Its Voice in Purpose'),
  (10, 'John 17:4', 'Finish the Work')
) AS v(n, ref, title) WHERE p.code = 'why-am-i-here';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'why-am-i-here'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', 'John 18:37', $dev$“You say that I am a king. In fact, the reason I was born and came into the world is to testify to the truth.”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,        $dev$Picture the scene. Jesus is on trial for His life. Pilate holds the power to release Him or crucify Him. The soldiers are near, the crowd is loud, the outcome looks bad. And in that pressure — where most of us would beg, spin, or fall silent — Jesus says the calmest thing in the room: "the reason I was born and came into the world." No panic. Just clarity.

That clarity did not appear at the trial; it had been there the whole time. At twelve, found in the temple, He said, "I must be about my Father's business" (Luke 2:49). At the height of His fame, when crowds wanted to keep Him, He said, "Let us go somewhere else… that is why I have come" (Mark 1:38). And here, at the end, He tells Pilate exactly why He exists. From temple to cross, one thread held Him together: He knew why He was born.

That is the quiet power of purpose. A person who knows why they are here cannot be scattered by applause or dismantled by opposition. Purpose was Christ's spine — and the wonder of the gospel is that His clarity becomes an inheritance for you. "We are God's workmanship, created in Christ Jesus to do good works, which God prepared in advance for us to do" (Ephesians 2:10). Read that slowly: the works are already prepared. You are not being asked to invent a purpose from nothing; you are being invited to discover one that already has your name on it.

So this is where the ten days begin. Not with pressure to manufacture a grand calling, but with the settled news that the God who knew why Jesus came also knows why you are here. Over the coming days we will follow the trail — through your burdens, your gifts, your seasons, and your service.

You may not be able to finish the sentence yet. That is fine. By the end of this plan, you will be closer than you have ever been.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Could you honestly complete the sentence "the reason I was born is…"? What comes out — and how sure do you feel about it?

— What would actually change in your ordinary week if that sentence were settled in you?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,        $dev$Lord Jesus, You knew exactly why You were born, and nothing could shake that clarity out of You. I confess mine still feels blurry. Walk me through these ten days until my purpose moves from a mystery I wonder about into an assignment I can name. Steady me the way clarity steadied You.

_May the question that kept you awake become the assignment that wakes you up._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,        $dev$John 18:33–37; Ephesians 2:8–10$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Isaiah 43:6–7', $dev$“Bring my sons from afar and my daughters from the ends of the earth — everyone who is called by my name, whom I created for my glory, whom I formed and made.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,        $dev$If purpose feels like a locked door with a code you can't quite crack, today's verse hands you the master key. Before purpose ever gets specific, it gets gloriously simple: you were created for the glory of God. That is the headline written over every human life — "created… formed… made" for His glory.

Hear where these words fall in Isaiah. God is speaking to a people scattered, exiled, feeling forgotten and useless — and He gathers them not with a job description but with an identity: you are mine, called by my name, made for my glory. He does not tell them their purpose is hiding at the end of some heroic achievement they may never reach. He tells them their worth is already fixed, because of Who made them and why.

That is a liberating answer, not a small one. It means you can fulfill the deepest layer of your purpose today — right now — in how you work, how you love, how you speak, how you worship. "Whether you eat or drink or whatever you do, do it all for the glory of God" (1 Corinthians 10:31). Nothing is too ordinary to count. The dishes, the emails, the commute, the difficult conversation — every one of them can be angled toward the pleasure of the One who made you.

So before you chase the specific assignment, settle the direction. Everything else this plan will uncover — your calling, your gifts, your timing, your service — sits on this foundation. Miss it, and purpose becomes a performance you can never finish. Grasp it, and even a quiet Tuesday becomes holy ground.

Purpose is not first a task to complete. It is first a life angled toward God's glory. Get the direction right, and the details will find their place.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,        $dev$— If "glory to God" is the headline over your life, what would this very day look like if you actually lived it under that banner?

— Where have you been chasing a purpose that impresses people, when God is offering one that honors Him?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,        $dev$Father, before I ask what I am supposed to do, I want to settle who it is all for. You created me for Your glory — so take the ordinary hours of this day and angle every one of them toward You. Let my work, my words, and my worship all point back to the One who made me.

_May your most ordinary hours begin to shine with the glory they were made for._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,        $dev$Isaiah 43:1–7; 1 Corinthians 10:31$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Jeremiah 1:5', $dev$“Before I formed you in the womb I knew you, before you were born I set you apart; I appointed you as a prophet to the nations.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,        $dev$Have you ever felt like you were simply dropped into the world and left to figure out something useful to do with yourself? Jeremiah could have felt exactly that. He was young, unsure, and quick to protest that he didn't know how to speak. So God took him back — all the way back, before the womb — to show him the order of his life.

Look at the sequence: known, set apart, appointed. All of it before birth. Jeremiah did not arrive on earth and then start auditioning for a role. The assignment predated the arrival. He was not dropped into history by accident; he was sent into it on purpose. And Scripture insists the same is true of you: "Before I formed you in the womb I knew you."

Sit with what that means. Before the beginning of time, God established the very days you would live (Psalm 139:16), and He set apart the work, the mandate, the assignment you would be needed for. Your birth was not a random event; it was heaven deploying a specific solution to problems it had already scheduled you to meet. You are, in the truest sense, an answer God prepared in advance and released at the appointed hour.

This changes the entire search for purpose. You are not standing in front of a blank page, inventing a calling out of your own preferences and hoping it fits. You are discovering an appointment that was made without asking your permission — and here is the good news: it is better than anything you would have designed for yourself. God's plans for you carry a weight and a fit that self-made ambition never can.

So stop living like someone dropped. Start living like someone sent. There are sealed orders with your name on them, and the God who wrote them is ready to open them.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Be honest: do you move through your days like someone dropped into the world, or someone deliberately sent into it?

— What problems around you stir something deep in you — as though they were scheduled for you to meet?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,        $dev$Father, You knew me, set me apart, and appointed me before I ever drew breath. I have wandered as though I were an accident; today I choose to believe I was sent. Open the sealed orders. I am ready to discover what You placed me on this earth to do, and I trust that it is better than anything I could have written myself.

_May you feel today the quiet dignity of a sent person walking an appointed earth._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,        $dev$Jeremiah 1:4–10; Psalm 139:16$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Colossians 3:23', $dev$“Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,        $dev$Many sincere believers carry a quiet guilt: they assume that to truly serve God they would have to leave their job and stand behind a pulpit. So they treat their real work — the farm, the classroom, the clinic, the shop — as a lesser holding pen while they wait for something "spiritual" to begin. Today's verse dismantles that lie completely.

Notice what Paul does not say. He does not say, "Whatever ministry you do." He says, "Whatever you do." He is writing, in fact, to household servants doing the most ordinary, unglamorous labor imaginable — and he tells them their work, done for the Lord, is worship. Purpose is not a change of address; it is a change of orientation. The moment any honest work is done "as working for the Lord," that desk becomes a sanctuary and that task becomes an offering.

Watch how this played out in Scripture. Daniel served a pagan government with such excellence that kings noticed. Lydia sold purple cloth. Joseph administered grain for a foreign empire. The purposeful people of the Bible were, for the most part, not clergy — they were people who did ordinary work with an extraordinary Master in view. As the saying goes, if a man is called to be a street sweeper, let him sweep streets the way Michelangelo painted — so that all heaven and earth pause to say, here lived a great sweeper who did his job well.

So do not despise your current desk, wishing it were an altar. It may already be the ground of your assignment. The question is not whether your job is holy enough; the question is whether you will do it with all your heart, for His eyes.

Work done with everything you have, for the Lord alone, is simply worship with its sleeves rolled up.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,        $dev$— How would your work tomorrow actually change if the Lord — not your boss or your clients — were your only supervisor?

— What excellence have you been quietly withholding because you tell yourself "it's just a job"?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,        $dev$Lord, I have been waiting for holy work to begin somewhere else, and missing the altar right in front of me. I re-orient my labor today: same desk, new Master. Receive this week's work as worship, and let my excellence preach where my words never could.

_May your workplace quietly become an altar this week._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,        $dev$Colossians 3:22–24; Proverbs 22:29$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Nehemiah 1:3–4', $dev$“They said to me, ‘Those who survived… are in great trouble and disgrace. The wall of Jerusalem is broken down.’ When I heard these things, I sat down and wept.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,        $dev$What breaks your heart? Not in the vague sense — everyone is sad about suffering in general. What specific brokenness sits on you heavier than it sits on the people around you? That question is one of purpose's most reliable compasses, and Nehemiah's story shows you why.

Nehemiah was a cupbearer — a comfortable, trusted man living in a palace far from the ruins of home. Then a report reached him: the survivors in Jerusalem were in trouble and disgrace, and the wall was broken down. He could have filed it away as distant, unfortunate news. Instead, "I sat down and wept." He fasted. He prayed for days. That report did not just inform him; it wrecked him.

And here is the pattern worth noticing: the weight in that report had an assignment hidden inside it. The man who cried over the walls became the man who rebuilt them. His burden was not a detour from his purpose — it was the doorway to it. This is how God often works: "your destiny is frequently birthed from your burden."

Look at your own heart the same way. Not every sad story moves you equally — but some particular ache does. The fatherless. The addicted. Children who cannot read. The coldness of the church. A community trapped in poverty. Whatever makes you weep, or makes you righteously and restlessly angry, is worth interrogating on your knees. That specific ache is not a weakness to be managed or numbed. It is a map.

God frequently addresses His repairs to the hearts that feel the damage most keenly. The tears you thought disqualified you may be the very evidence of your calling. So stop apologizing for the ache — and start asking what it is pointing you toward.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,        $dev$— What specific brokenness moves you far more than it seems to move the people around you?

— If that burden had an assignment hidden inside it, what do you sense it might be?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,        $dev$Father, I have treated my ache as a problem to escape instead of a message to read. Today I stop apologizing for it. Show me the assignment You buried inside my burden, and give me Nehemiah's courage to move from weeping over what is broken to building what You want restored.

_May your deepest ache reveal itself as your clearest assignment._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,        $dev$Nehemiah 1:1–11; Judges 6:11–14$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'Nehemiah 2:8', $dev$“And the king granted them to me, because the good hand of my God was upon me.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,        $dev$Yesterday Nehemiah wept over a broken wall. Today watch that burden become a mission — and as it does, three confirmations emerge that still mark a genuine purpose. Call them the three Ps: passion, possibilities, and provision.

First, passion. When God truly calls you to something, He plants a holy restlessness for it. Nehemiah simply could not rest while the walls lay in ruins; the burden would not let him settle back into palace comfort. That is how a real calling feels — not a passing interest, but a fire that will not go out. When God stirs that restlessness in you toward something good, do not analyze it to death. Go and do it.

Second, possibilities. God opens doors you did not push on. Nehemiah asked, and the king granted him leave, official letters, and timber for the gates. Opportunity moved toward the assignment. But note the discipline this requires: when a door refuses to open, ask the honest, discerning question — is it simply not yet the time, or am I not the person for this at all? Both answers are grace; both spare you from forcing what God has not opened.

Third, provision. Resources follow the call. The king supplied the very materials Nehemiah would need (Nehemiah 2:7–9), because where God guides, He also provides. Purpose that is truly from God does not usually leave you permanently stranded and empty-handed; heaven has a way of funding what heaven has assigned.

And the result? Under these three confirmations, a wall that had shamed an entire nation for over a century was finished in fifty-two days. When passion, possibility, and provision align, do not hesitate — build. God is not confirming your calling so you can admire it. He is confirming it so you will move.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Where do passion, possibility, and provision currently overlap in your life — even faintly?

— Which of the three are you still waiting on, and what would faithful, un-anxious waiting actually look like for you?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,        $dev$Father, confirm my path the Nehemiah way. Plant the passion that will not let me rest, open the possibilities I could never force, and send the provision only You can supply. And when all three finally line up, do not let me hesitate — give me holy speed to build what You have called me to.

_May doors you never pushed on begin to swing open before you._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,        $dev$Nehemiah 2:1–9; 6:15–16$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'Ecclesiastes 3:1', $dev$“There is a time for everything, and a season for every activity under the heavens.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,        $dev$Don't eat your dinner in the morning. It sounds like a joke, but it holds one of the most overlooked truths about purpose: timing is not a detail — it is half the assignment. A right calling forced into the wrong season produces exactly the same fruit as a wrong calling: frustration, striving, and a strange sense that something isn't working no matter how hard you push.

Solomon, who had watched more seasons come and go than almost anyone, framed it plainly: "There is a time for everything." Not everything is for now. The mango that ripens on the tree in its own season is sweeter than the one shoved into a sack and forced ripe overnight — and the difference is not the mango, but the timing.

David lived this beautifully. He was anointed king years before he ever wore a crown. And when the throne seemed within reach — when Saul lay asleep and defenseless, a single spear-thrust from being removed — David refused to force what only God had the right to give (1 Samuel 26:9–11). He let God's timing do the promoting. And because he did not seize the season early, the kingdom he eventually received actually stood.

This means purpose requires two disciplines, not one. First, knowing what you are called to. But second — and just as vital — discerning when. So do not only ask God, "What is my assignment?" Also ask, "What does this season require of me right now?" Sometimes the answer is build. Sometimes it is wait. Sometimes it is learn, or prepare, or serve quietly in obscurity.

And here is the encouragement: your preparation seasons are not delays. They are dinner cooking. What feels like a maddening pause may simply be God bringing your purpose to its full, sweet ripeness — so that when it finally comes, it lasts.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Where might you be trying to eat dinner in the morning — pursuing the right call, but in the wrong hour?

— What does your current season actually require of you right now: building, waiting, learning, or launching?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,        $dev$Lord of every season, save me from two mistakes — harvesting my purpose too early and sleeping through its harvest too late. Name the season I am actually in, and give me the humility and grace to do exactly what it requires, trusting that You are ripening what You have promised.

_May every purpose in your life ripen sweetly in its own appointed season._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,        $dev$Ecclesiastes 3:1–11; 1 Samuel 26:9–11$dev$),
  (8, 1, 'scripture',  'Today''s Reading', 'Mark 10:45', $dev$“For even the Son of Man did not come to be served, but to serve, and to give his life as a ransom for many.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,        $dev$If you cannot yet see your purpose, here is a counterintuitive instruction: stop squinting at the horizon and pick up a towel. Some of the clearest revelations of purpose come not from more introspection, but from humble service. And no one modeled this like Jesus, who — being the Son of God Himself — said He "did not come to be served, but to serve."

Look at how many of Scripture's destined people first learned to serve. Joseph served faithfully in Potiphar's house and then in a prison before he ever governed Egypt. Joshua served Moses for years before he led the nation. Elisha poured water on Elijah's hands before he inherited a double portion. David served in Saul's household with nothing but a harp before he wore a crown. In each case, the serving was not a delay of destiny. It was the discovery of it.

Why does service reveal purpose so powerfully? Consider three reasons. First, it puts your gifts in motion where you can finally observe them — you rarely discover what is in your hands until you use them for someone else. Second, it grows you in another person's vineyard until God is ready to plant you in your own; there is a training that only happens under someone else's roof. Third, and most crucial, it kills the pride that ruins purpose at the root — because a person who has learned to serve will not weaponize their calling for their own glory.

So do not wait until you feel qualified or clear before you begin. Find a place to serve — this week, somewhere ordinary, with no title and no spotlight — and pay attention to what rises in your hands as you pour yourself out for others.

A towel in your hands will often reveal what years of anxious self-analysis never could.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Where are you currently serving with no title, no recognition, and no spotlight?

— What gifts or instincts have you noticed rising in your hands specifically when you serve other people?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,        $dev$Lord Jesus, You held all authority and still chose the towel and the basin. Make me like You. Lead me this week to a vineyard where I can pour water on someone else's hands without needing the credit — and reveal my purpose to me in the very act of pouring.

_May a towel in your hands do what a title never could._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,        $dev$Mark 10:42–45; 2 Kings 3:11; Luke 16:12$dev$),
  (9, 1, 'scripture',  'Today''s Reading', 'Psalm 138:8', $dev$“The Lord will vindicate me; your love, Lord, endures forever — do not abandon the works of your hands.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,        $dev$Something happens to worship when purpose awakens: it finds its voice. A person who knows they are on assignment thanks God differently — the singing turns personal, the gratitude gets specific, and praise stops being a duty and becomes a natural overflow. When you put genuine praise into your purpose, it releases a power that changes everything about how you carry it.

But there is a reverse truth here too, and it is a guardrail every purposeful person needs. Gratitude is what keeps purpose healthy. Purpose without praise slowly curdles into ambition; the mission that began as an offering to God quietly becomes a monument to you. Daily thanksgiving is the antidote — it keeps the assignment filed under its rightful Owner's name, reminding you every morning whose work this really is.

Today's verse is the worker's anthem. Read the older rendering of it: "The Lord will fulfill his purpose for me." Not "I will grind my purpose into existence through sheer effort and willpower," but "He will fulfill" — you cooperate, He completes. That single shift takes the crushing weight off your shoulders. Paul says the same: "he who began a good work in you will carry it on to completion" (Philippians 1:6). Your purpose does not rest finally on your competence. It rests on His faithfulness.

So build the habit now, before the pressure of the assignment tempts you to grind alone. At every step of progress — praise. At every closed and disappointing door — praise, because His timing is trustworthy. At every small and unimpressive beginning — praise, because He is the One who finishes.

Purpose walks its farthest and its longest on grateful legs. Ambition will exhaust you by mile ten; gratitude will still be singing at mile a hundred.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,        $dev$— Lately, has your pursuit of purpose been fueled more by anxious ambition or by genuine gratitude? How can you tell?

— What progress in your life — however small or unfinished — actually deserves your praise today?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,        $dev$Father, I put praise back inside my purpose, where it belongs. Thank You for what You have already done in me and for what You have already written over me. I release the crushing pressure to fulfill it all by my own strength — You will fulfill Your purpose for me, and I will thank You at every single mile.

_May gratitude carry your purpose farther than ambition ever could._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,        $dev$Psalm 138; Philippians 1:6$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'John 17:4', $dev$“I have brought you glory on earth by finishing the work you gave me to do.”$dev$),
  (10, 2, 'devotional', 'Devotional',      NULL,        $dev$On the night before He died, Jesus prayed a sentence that quietly redefines what a successful life even is: "I have brought you glory on earth by finishing the work you gave me to do." Read it carefully, because it corrects one of our deepest anxieties. He did not say, "I have done all the possible good there was to do." When He prayed this, there were still sick people in Israel He had not healed, still villages He had never entered, still needs everywhere that would outlive Him. And He called His work finished.

That is the truth that sets purposeful people free. Purpose is not the exhaustion of every need around you — that road has no end and will drive you into the ground. Purpose is the completion of the specific lines written in your book. Not everyone's assignment. Yours. Jesus finished His by staying faithful to the particular work the Father gave, and He left the rest of the world's needs to other faithful hands.

Scripture gives ordinary people the same epitaph to covet. Of David it simply records: "when David had served God's purpose in his own generation, he fell asleep" (Acts 13:36). His own generation — the only one he was ever given. He did not have to fix all of history. He served his slice of it faithfully, and heaven called that a life well spent.

So go now with the compass these ten days have given you. You were made for His glory, sent with a real assignment, and you can find your way by following your burden, your gifts, your seasons, and your service. You do not have to do everything. That was never the assignment. You only have to finish yours.

May it be said of you what was said of David — that you served God's purpose in your own generation, and then, with nothing left undone, you rested.$dev$),
  (10, 3, 'talk',      'Talk it Over',     NULL,        $dev$— Write your own John 17:4 sentence: what specific work must you finish before you sleep?

— What is the very next faithful step toward it that you could take this week?$dev$),
  (10, 4, 'devotional', 'Pray',            NULL,        $dev$Father, I have one prayer for the rest of my days: let me finish the work You gave me. Not everyone's work — mine. Free me from the pressure to fix everything, and fix my heart on the assignment You actually wrote for me. And when I finally sleep, let it be said that I served Your purpose in my own generation.

_May you live so purposefully that your last prayer can be, "I have finished the work."_$dev$),
  (10, 5, 'reading',    'Go Deeper',       NULL,        $dev$John 17:1–4; Acts 13:36; 2 Timothy 4:7$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
