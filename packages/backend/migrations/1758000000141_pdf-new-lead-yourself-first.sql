-- Lead Yourself First: NEW 15-day plan seeded from the author's PDF (source of truth).
-- Each day: key verse (scripture) -> Devotional -> Talk it Over (Reflect) ->
-- Pray (+blessing) -> Go Deeper. Re-runnable: plan upserts by code and days
-- are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
INSERT INTO reading_plans (code, title, subtitle, description, category, day_count, sort, image_url, is_active)
VALUES ('lead-yourself-first', 'Lead Yourself First', 'Fifteen days of divine self-leadership — because no man can lead others where he has never taken himself.', 'Our world is full of people in leadership positions — and starving for leadership. The gap is not talent or title; it is a neglected first territory. No man can offer true leadership to his external surroundings until he offers leadership to himself. It is like a tour guide: you can only take others where you have traveled before. And there is a deeper distinction this plan will unveil: there are two kinds of self-leadership. One is carnally induced — ignited by passion, ambition, anger or the need to prove a point, maintained by sheer willpower. The other is divinely authored — flowing from God who created you, fashioned you for an assignment, and leads you from within. Saul of Tarsus lived both, and the difference changed the world. Fifteen days. One territory — yourself. Take it, and every other territory becomes possible.', 'Leadership', 15, 27, 'https://images.unsplash.com/photo-1508672019048-805c876b67e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080', TRUE)
ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description, category = EXCLUDED.category,
  day_count = EXCLUDED.day_count, sort = EXCLUDED.sort, image_url = EXCLUDED.image_url;
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'lead-yourself-first');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Mark 10:45', 'The Leader Who Led Himself First'),
  (2, 'Matthew 5:16', 'Leadership Is Influence'),
  (3, '1 Corinthians 11:1', 'The Tour Guide Principle'),
  (4, 'Proverbs 25:28', 'A City With Walls'),
  (5, 'Proverbs 16:32', 'Mightier Than the Warrior'),
  (6, 'Titus 3:3', 'Carnal Self-Leadership: The Fire That Burns Its Carrier'),
  (7, 'Acts 22:4, 3', 'Saul of Tarsus: The Case Study'),
  (8, 'Philippians 2:13', 'Divinely Authored Self-Leadership'),
  (9, 'Titus 3:5; Ephesians 4:23', 'The Washing That Renews Leadership'),
  (10, 'Psalm 139:23', 'Know Your Triggers'),
  (11, 'Mark 1:35', 'Stop, and Step Back'),
  (12, '1 Timothy 4:8', 'Train Yourself for Godliness'),
  (13, 'John 13:4–5', 'Lead With No Title'),
  (14, '1 Peter 5:2–3', 'Leading Others: The Overflow'),
  (15, 'Ephesians 1:17', 'The Four Revelations of a Led Life')
) AS v(n, ref, title) WHERE p.code = 'lead-yourself-first';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'lead-yourself-first'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Mark 10:45', $dev$“For even the Son of Man did not come to be served, but to serve, and to give his life as a ransom for many.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Before Jesus led multitudes, He led Himself — through forty days of wilderness testing, where every shortcut to greatness was offered and refused. Bread without the Father's word: refused. Spectacle without the cross: refused. Kingdoms without Calvary: refused. The public ministry that followed stood on private victories already won.

This is the pattern of all true leadership: authority over others flows from authority over self. The Christ who commanded storms had first commanded His own appetites, ambitions and fears — all the way to Gethsemane's “not my will, but yours.”

So this plan begins where He began: not with techniques for managing people, but with the wilderness work of governing yourself under God. Lead yourself first — the way the Master did — and leading others becomes overflow instead of performance.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Which "wilderness shortcut" — comfort, spectacle, or compromise — most tempts your leadership?

— Where does your public role currently exceed your private victories?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, Leader of leaders, take me through the wilderness You mastered. Give me private victories worthy of public trust — I will lead myself first, under You. Amen.

_May your private victories quietly grow larger than your public assignments._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 4:1–11; Mark 10:42–45$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Matthew 5:16', $dev$“Let your light shine before others, that they may see your good deeds and glorify your Father in heaven.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Strip leadership of its titles and offices, and its essence remains: influence. The word comes from the Latin influere — to flow into, like a river flowing into a lake. Influence is the ability to shape opinions and actions without compelling them — soft power, independent of position.

This definition democratizes leadership gloriously: the mother shaping children, the employee whose excellence lifts a department, the friend whose faith steadies a circle — all leading, title or none. And it exposes the empty office: position without influence is furniture.

From a Biblical perspective, leadership is influencing and serving others out of Christ's interests in their lives — “not looking to your own interests but each of you to the interests of the others” (Philippians 2:4). Ask today: what is currently flowing out of me into the people around me — and is it what I would wish multiplied?$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What actually "flows out" of you into your closest people — faith, fear, peace, pressure?

— Where do you carry influence without title that you have been neglecting?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, make my life a clean river. Let what flows from me into others carry Christ's interests for them — influence worth multiplying, with or without a title. Amen.

_May your influence outgrow your titles all the days of your life._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 2:1–4; Matthew 5:13–16$dev$),
  (3, 1, 'scripture', 'Today''s Reading', '1 Corinthians 11:1', $dev$“Follow my example, as I follow the example of Christ.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Of the many leaders in leadership positions, few have mastered self-leadership — and the cost is universal: you can only lead others to the extent you lead yourself. Like a tour guide, you can only take people where you have traveled before.

This is why hollow leadership eventually echoes: the preacher of peace with a chaotic home, the coach of discipline with untamed appetites, the giver of counsel who has never taken his own. It's easier to give instructions to others than to apply the same instructions to yourself — and everyone eventually notices the guide has never seen the destination.

Paul could write today's dangerous sentence — follow my example — because his private map matched his public tours. Make that your ambition: not to sound like a guide, but to have traveled. Every discipline of these fifteen days is territory covered — for the sake of everyone you will one day guide through it.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Where are you currently "guiding" territory you have not personally traveled?

— What journey must you take first, so your leading becomes honest?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, close the gap between my map and my travels. Take me first through what I teach — until "follow my example" can be said without blushing. Amen.

_May everyone who follows you arrive somewhere you have truly been._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$1 Corinthians 11:1; 9:24–27$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Proverbs 25:28', $dev$“Like a city whose walls are broken through is a person who lacks self-control.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$In the ancient world, a city's walls were its life: they decided what entered and what was kept out. Solomon's image is precise — the person without self-control is not a weak city; he is an open one. Every passing impulse, offense and appetite walks in unchallenged and helps itself.

From a Biblical perspective, self-leadership is many times written as self-control — a fruit of the Spirit, not a feat of the jaw (Galatians 5:23). And its first gate is the mouth: “Whoever guards his mouth and tongue keeps his soul from troubles” (Proverbs 21:23). The power to govern one's own words and reactions is not readily found in all men — which is exactly why it distinguishes leaders.

Inspect your walls today: where are the breaches — the tongue, the temper, the appetite, the screen? Name them without shame, and invite the Spirit to the reconstruction. Rebuilt walls are this plan's project.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Where are your wall-breaches — which impulses currently enter unchallenged?

— Which gate needs the first repair: mouth, temper, appetite, or attention?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Spirit of God, Builder of walls, survey my city. Repair the breaches — beginning at the gate of my mouth — until what enters and leaves my life passes proper inspection. Amen.

_May your rebuilt walls make your city safe for everyone who lives near you._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 25:28; 21:23; Galatians 5:22–23$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Proverbs 16:32', $dev$“Better a patient person than a warrior, one with self-control than one who takes a city.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Heaven keeps different rankings than earth. Earth celebrates the warrior who takes a city; heaven ranks above him the person who governs their own spirit. Conquering others requires an army; conquering yourself requires something rarer.

History agrees with the proverb: how many city-takers — brilliant generals, empire builders, gifted founders — were finally taken by their own ungoverned selves? The conquered city of their appetites undid every city their armies won. Meanwhile Joseph, governing only himself in a prison, ended up governing Egypt.

So recalibrate your ambitions this morning: the greatest conquest available to you this year is not the market, the ministry or the promotion — it is you, brought gladly under the government of God. Take that city, and the others come with keys.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Which "outer city" have you been fighting for while the inner one stands unconquered?

— What would taking the inner city look like this season — concretely?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, reorder my conquests. Before markets and ministries, give me victory over my own spirit — the patient strength You rank above warriors. Amen.

_May you take the one city this year that makes every other city possible._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 16:32; Genesis 39–41$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Titus 3:3', $dev$“At one time we too were foolish, disobedient, deceived and enslaved by all kinds of passions and pleasures.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Now the deeper diagnosis. There is a self-leadership that looks impressive and ends badly: carnally induced self-leadership — born of passion, ambition, anger or revenge, ignited by some event that wounded or provoked, and maintained by continuous high-level discipline of sheer will.

Its trademark is the end-goal that justifies everything: results by hook or by crook, processes honored only when they serve the dream. Its fuel gauge reads: proving them wrong, healing the old wound with achievement, feeding an ego that is never full. Many of us live entirely under this leadership and call it drive.

And it works — for a while. That is its danger. But fires fed on wounds eventually burn their carriers: the resultant harvest is envy, pride, shortcuts, bribes given and taken, and exhaustion of soul. Today, courageously check the fuel: what is actually driving your drive?$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What event — wound, insult, lack — originally ignited your drive?

— Where do you recognize "by hook or by crook" reasoning in your pursuits?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, I open the engine room. Show me every place my leadership runs on wounds, ego or revenge — I would rather be re-fueled than burn my own life. Amen.

_May every fire that was burning you be exchanged for one that carries you._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Titus 3:3; James 3:14–16$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Acts 22:4, 3', $dev$“I persecuted the followers of this Way to their death… I was just as zealous for God as any of you are today.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Meet carnal self-leadership at its most disciplined: Saul of Tarsus. Brilliant, credentialed, relentlessly zealous — an illustrious Pharisee whose whole formidable will was organized around one objective, pursued by every available means: breathing threats, obtaining letters, dragging families to prison. Total self-mastery. Totally wrongly aimed.

That is the terror of carnal self-leadership: it can be devout, disciplined and utterly sincere — Saul believed he served God — while marching at full speed away from His will. Zeal is not evidence of alignment; some of the most driven people alive are excellently leading themselves in the wrong direction.

Then came the Damascus road: “Who are you, Lord?” — the question that ends carnal self-leadership, and the surrender that begins another kind: “What shall I do, Lord?” (Acts 22:10). Same will, same fire, new Author. The transformation of leadership begins with those two questions.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where might your zeal be sincere, disciplined — and misaimed?

— Ask both Damascus questions slowly today: Who are You, Lord? What shall I do, Lord?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord, interrupt me like You interrupted Saul. Examine my zeal, re-aim my fire — I ask the surrendered question: what shall I do, Lord? Amen.

_May every misaimed zeal in you meet its Damascus — gently, and soon._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Acts 22:1–16; Philippians 3:4–9$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Philippians 2:13', $dev$“For it is God who works in you to will and to act in order to fulfill his good purpose.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Now the better country: divinely authored self-leadership. It is birthed not by a wound but by a revelation — understanding God's will and purpose over one's life. It flows from the God who created you, fashioned you for specific assignments, and equipped you with all you require to carry them out.

Feel the difference in the engine: carnal self-leadership pushes from behind (the wound, the point to prove); divine self-leadership draws from ahead (the assignment, the written book). One is maintained by grinding willpower; the other is sustained by grace — “God works in you to will and to act.” Even the willing is supplied!

This is why divinely-led people can work as hard as the driven without burning like them: the fire comes from a different altar. Paul post-Damascus labored “more than all of them — yet not I, but the grace of God that was with me” (1 Corinthians 15:10). Same intensity, new authorship. Ask today for the transfer of authorship.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Is your life currently pushed from behind or drawn from ahead?

— What would "grace-sustained intensity" look like in your week?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Author of my assignment, take the pen. Work in me to will and to act for Your good purpose — draw me from ahead, sustain me by grace, and author my leadership. Amen.

_May the authorship of your drive change hands this very week._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 2:12–13; 1 Corinthians 15:9–10$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Titus 3:5; Ephesians 4:23', $dev$“He saved us through the washing of rebirth and renewal by the Holy Spirit… Be made new in the attitude of your minds.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$How does one cross from carnal to divine self-leadership? Not by resolution — the will was never the problem; its authorship was. Divinely authored leadership comes when we experience the washing of rebirth and the daily renewal of the mind.

The sequence matters: first the washing — old fuels confessed and released: the wound that drove you, the ego that steered you, the revenge that focused you, brought honestly to the cross and left there. Then the renewal — the mind re-authored day by day in the Word, until God's assignment, not your history, sets the agenda.

And this is a maintained crossing, not a one-time event: leaders drift back to old fuels under pressure, which is why the renewal is daily. Revelation must be sequentially arranged — one truth building on another — until the new authorship holds under load. Build the daily altar; it is the engine room of everything ahead.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— Which "old fuel" must go to the cross today — named specifically?

— What does your daily renewal altar look like: when, where, what Word?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, wash the engine room. I bring the old fuels to the cross by name, and I build the daily altar of renewal — re-author me every morning until it holds. Amen.

_May your daily altar keep the new authorship strong under every load._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Titus 3:3–7; Romans 12:1–2$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Psalm 139:23', $dev$“Search me, God, and know my heart; test me and know my anxious thoughts.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$The self-leader's first discipline is self-awareness: knowing your God-given intentions and values — and knowing, just as precisely, what can push your buttons and derail you. A man who does not know his own triggers will be governed by whoever discovers them first.

Map yours honestly: which criticism unravels you? Which comparison poisons your joy? Which fatigue makes you cruel, which flattery makes you foolish, which room makes you perform? These are not shameful discoveries; they are intelligence for the city's defense — you now know which gates need extra watchmen.

David shows the fearless way: he invited God Himself into the mapping — search me, test me, see. Self-awareness under the Spirit is not morbid introspection; it is a guided tour of your own walls with the Builder. Take the tour this week, notebook in hand.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Name your top three triggers — the buttons that reliably derail you.

— Which gate gets extra watchmen from today, and what does that mean practically?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Search me, God — walls, gates, buttons and all. Turn my blind spots into guarded posts, and let self-awareness become the defense of everything You are building in me. Amen.

_May you come to know your own city so well that no ambush ever finds it sleeping._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139:23–24; Lamentations 3:40$dev$),
  (11, 1, 'scripture', 'Today''s Reading', 'Mark 1:35', $dev$“Very early in the morning, while it was still dark, Jesus got up, left the house and went off to a solitary place, where he prayed.”$dev$),
  (11, 2, 'devotional', 'Devotional', NULL, $dev$Here is the self-leader's master skill: when provocation or pressure comes — stop, and step back. The man who reacts to every trigger is being led by the trigger; whoever controls your reactions is your actual leader. Stepping back breaks the puppet strings and returns the government to God.

From that recovered stillness, act from intention — your values and assignment — rather than from reaction. Intention precedes purposeful action; purposeful action produces influence; and influence, measured over a life, is what heaven calls impact.

Watch the pattern in Jesus: before choosing the twelve, a night in prayer; after great success at Capernaum, a dark-morning withdrawal while crowds demanded more; before the cross, Gethsemane. His public decisiveness grew in solitary places. Build yours: a daily stepping-back where reactions are surrendered and intentions are set — before the day starts pulling strings.$dev$),
  (11, 3, 'talk', 'Talk it Over', NULL, $dev$— Who or what most reliably "pulls your strings" into reaction?

— Where and when will your daily stepping-back happen, starting tomorrow?$dev$),
  (11, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, teach me Your rhythm: the stop, the stepping back, the solitary place. Cut the puppet strings of reaction, and let my actions flow from intention set with You. Amen.

_May the solitary place become the control room of your entire public life._$dev$),
  (11, 5, 'reading', 'Go Deeper', NULL, $dev$Mark 1:32–39; Luke 6:12–13$dev$),
  (12, 1, 'scripture', 'Today''s Reading', '1 Timothy 4:8', $dev$“For physical training is of some value, but godliness has value for all things, holding promise for both the present life and the life to come.”$dev$),
  (12, 2, 'devotional', 'Devotional', NULL, $dev$From a Roman prison, Paul coached his spiritual son with an athlete's vocabulary: train yourself to be godly. The word is from the gymnasium — sweat, repetition, progressive load. Character, like muscle, is built by a strong will submitted to consistent routine over time; it demands a high standard of discipline maintained across seasons.

Notice what this rescues us from: waiting for godliness to arrive by feelings or by miracle. The fruit is the Spirit's; the training ground attendance is yours. Prayer at appointed times, the Word before the phone, fasting that masters appetite, service that kills entitlement — these are the self-leader's gym equipment.

And Paul adds the athlete's motivation: physical training profits a little (steward the body too — it carries the assignment), but godliness pays in two lifetimes. No workout in the world offers that contract. Sign it daily.$dev$),
  (12, 3, 'talk', 'Talk it Over', NULL, $dev$— What does your current "training program" for godliness actually consist of?

— Which one piece of gym equipment — prayer, Word, fasting, service — needs scheduling this week?$dev$),
  (12, 4, 'devotional', 'Pray', NULL, $dev$Father, enroll me in the gymnasium of godliness. I bring the attendance; Your Spirit brings the growth — train me for a profit that spans two lifetimes. Amen.

_May your unseen training sessions become everyone else's visible blessing._$dev$),
  (12, 5, 'reading', 'Go Deeper', NULL, $dev$1 Timothy 4:7–10; Hebrews 5:14$dev$),
  (13, 1, 'scripture', 'Today''s Reading', 'John 13:4–5', $dev$“So he got up from the meal, took off his outer clothing, and wrapped a towel around his waist… and began to wash his disciples’ feet.”$dev$),
  (13, 2, 'devotional', 'Devotional', NULL, $dev$The greatest leadership demonstration in history required no title, no platform and no permission — a towel, a basin, and the will to kneel. Jesus, “knowing that the Father had put all things under his power,” used that power to wash feet. Ultimate authority, expressed as ultimate service.

This frees you to lead from exactly where you stand: leaders are those who do what the unwilling avoid — who solve the problem nobody owns, encourage the person nobody notices, raise the standard nobody demands — title or no title, portfolio or none. Influence flows to servants long before offices do.

So stop waiting for the appointment to begin the assignment. Find this week's towel: the task beneath you, the person beside you, the standard above the room's average. “Now that you know these things, you will be blessed if you do them” (John 13:17).$dev$),
  (13, 3, 'talk', 'Talk it Over', NULL, $dev$— What "towel" is lying in your vicinity that titled people are stepping over?

— Where have you postponed leading because the appointment hasn't come?$dev$),
  (13, 4, 'devotional', 'Pray', NULL, $dev$Lord of the towel, cure me of waiting for titles. I take up this week's basin — and I trust You with every appointment, in Your time. Amen.

_May the towels you carry in obscurity become the crowns you wear in due season._$dev$),
  (13, 5, 'reading', 'Go Deeper', NULL, $dev$John 13:1–17; Luke 22:24–27$dev$),
  (14, 1, 'scripture', 'Today''s Reading', '1 Peter 5:2–3', $dev$“Shepherd the flock of God that is among you… not domineering over those in your charge, but being examples to the flock.”$dev$),
  (14, 2, 'devotional', 'Devotional', NULL, $dev$Now the territory expands — for self-leadership was never the destination, only the first conquest. Led people are given people to lead. And your self-leadership sets the house rules: teams forgive what leaders confess and copy what leaders practice; you will reproduce what you are far more than what you say.

Guard especially the team's togetherness. Though many of us love the idea of team, we often use the team concept to separate rather than connect — subgroups pitted against each other, fueling animosity and shrinking the shared resource. The self-led leader does the opposite: expands the circle, shares the credit, absorbs the blame, and connects what politics would divide.

Lead Peter's way: willingly, not for gain; by example, not domination. Nehemiah rebuilt a wall in fifty-two days with families each building their portion — order, shared burden, one vision. That is what leading others looks like when the leader has first been led.$dev$),
  (14, 3, 'talk', 'Talk it Over', NULL, $dev$— What are your people currently "copying" from you — audit honestly?

— Where has the team concept been used to separate around you, and how will you reconnect it?$dev$),
  (14, 4, 'devotional', 'Pray', NULL, $dev$Chief Shepherd, make my leading an overflow of being led. Give me example over domination, connection over camps — and a flock that finds You through following me. Amen.

_May the people in your charge one day thank God for the season they were led by you._$dev$),
  (14, 5, 'reading', 'Go Deeper', NULL, $dev$1 Peter 5:1–4; Nehemiah 3–4$dev$),
  (15, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:17', $dev$“I keep asking that the God of our Lord Jesus Christ, the glorious Father, may give you the Spirit of wisdom and revelation, so that you may know him better.”$dev$),
  (15, 2, 'devotional', 'Devotional', NULL, $dev$As we crown these fifteen days, receive the map of the fully led life — four fundamental revelations every man and woman must grasp: your identity — who God made you (settled in the earlier miles of this journey); your times — the season you are in and what it requires; your mandate — the assignment written over your life; and your destiny — where your book is heading.

These are not information; they are revelations — “not of flesh and blood,” unlocked by the Spirit of wisdom, arriving sequentially, one truth building on the other. The self-led life keeps asking for them, keeps receiving them, keeps walking in them.

So go now, doubly commissioned: govern your city daily under the divine Author, and lead every person in your charge as overflow. When a man understands he is here by God's design and no other — he starts to look at himself differently. You do now. Lead accordingly.$dev$),
  (15, 3, 'talk', 'Talk it Over', NULL, $dev$— Which of the four revelations — identity, times, mandate, destiny — is dimmest for you?

— What will you carry from these fifteen days as permanent practice — name three disciplines?$dev$),
  (15, 4, 'devotional', 'Pray', NULL, $dev$Glorious Father, give me the Spirit of wisdom and revelation — identity, times, mandate, destiny, each in its sequence. I take up the led life, and I will lead as overflow. Amen.

_May the four revelations light your path until the day your book is finished._$dev$),
  (15, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 1:15–21; 1 Chronicles 12:32$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
