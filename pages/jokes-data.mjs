/*
 * Ride Leader Games — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. This program is distributed WITHOUT ANY WARRANTY;
 * see the GNU General Public License <https://www.gnu.org/licenses/> for details.
 *
 * Ride Leader Games — joke deck data (framework-agnostic, no DOM).
 *
 * ~200 short, original bicycle jokes for the control window's joke feature. Each is a two-part
 * question/answer so the send flow can reveal the setup first and the punchline after a
 * configurable delay (see JokeDeck in jokedeck.mjs and onSendJoke() in control.mjs).
 *
 * These are hand-written puns on common cycling vocabulary (two-tired, spoke/speak, brake/break,
 * wheel/we'll, chain, gear, recycle/cycle-path, etc.). The wordplay is folk humour; the specific
 * phrasing here is original to this mod — no text was copied from any collection.
 *
 * Format: {setup, punchline}. Keep both parts short so they fit comfortably in Zwift chat.
 */
export const JOKES = [
    // ---- two-tired / flat / pressure ----
    {setup: "Why can't a bicycle stand up on its own?", punchline: "Because it's two tired."},
    {setup: "Why did the cyclist skip the evening ride?", punchline: "She was feeling two tired."},
    {setup: "What did the bike say after a long century?", punchline: "'I'm absolutely two tired.'"},
    {setup: "Why did the bike lie down for a nap?", punchline: "It was two tired to stay up."},
    {setup: "Why don't bicycles ever win arguments?", punchline: "They always fall flat."},
    {setup: "What did the inner tube say at the party?", punchline: "'Sorry, I just can't handle the pressure.'"},
    {setup: "Why did the flat tire go to therapy?", punchline: "It had nothing left to give."},
    {setup: "How does one tire flirt with another?", punchline: "'I'm wheely tired of being single.'"},
    {setup: "Why was the tire so relaxed?", punchline: "It knew how to let off a little pressure."},
    {setup: "What do you call a nervous tire?", punchline: "A little deflated."},
    {setup: "Why did the tire fail its big exam?", punchline: "It kept going flat under pressure."},
    {setup: "Why did the puncture ruin the joke?", punchline: "It had no pressure behind it."},
    {setup: "What's a tire's least favorite feeling?", punchline: "Being let down."},
    {setup: "Why did the tire join a band?", punchline: "It had great pressure and even better rhythm."},
    {setup: "How do you cheer up a sad tire?", punchline: "You pump it back up."},

    // ---- spoke / speak ----
    {setup: "What do you call a wheel that gives great advice?", punchline: "A real spoke-sperson."},
    {setup: "Why did nobody trust the wheel?", punchline: "It only ever spoke in circles."},
    {setup: "How do bicycles have heart-to-hearts?", punchline: "They spoke from the heart."},
    {setup: "Why was the wheel such a good speaker?", punchline: "It had plenty of spokes to lean on."},
    {setup: "What did the rude wheel do?", punchline: "It spoke out of turn."},
    {setup: "Why did the wheel get promoted?", punchline: "It became spokesperson for the whole bike."},
    {setup: "What's a wheel's favorite kind of poetry?", punchline: "Spoke-n word."},
    {setup: "How did the shy cyclist finally open up?", punchline: "A friend helped him find his spokes."},
    {setup: "Why was the wheel invited to every debate?", punchline: "It always had a strong spoke-n case."},
    {setup: "What did the wheel say when it broke a promise?", punchline: "'I spoke too soon.'"},
    {setup: "Why did the wheel get an award?", punchline: "For being outspoke-n."},

    // ---- chain ----
    {setup: "What do you call a bike that keeps everyone linked?", punchline: "A real chain-gang leader."},
    {setup: "Why did the bike mechanic love Mondays?", punchline: "Every day was one big chain reaction."},
    {setup: "What did the greasy chain say?", punchline: "'Sorry, I'm a little tied up right now.'"},
    {setup: "Why did the chain go back to school?", punchline: "To work on its links."},
    {setup: "How do cyclists stay close?", punchline: "They keep in chain."},
    {setup: "Why was the old chain so stressed?", punchline: "It felt stretched too thin."},
    {setup: "What do you call unbreakable cycling friends?", punchline: "A strong chain of trust."},
    {setup: "Why did the chain skip the meeting?", punchline: "It didn't want to make a scene."},
    {setup: "What's a chain's favorite dance?", punchline: "Anything with a good link step."},
    {setup: "Why did the rusty chain apologize?", punchline: "It had really let things slip."},

    // ---- gear / idea ----
    {setup: "Why did the smart bike ace the test?", punchline: "It had gears turning the whole time."},
    {setup: "What did the cyclist say about his best plan?", punchline: "'That's the finest gear I've had all day.'"},
    {setup: "How did the bike stay calm on the climb?", punchline: "It just dropped into an easier gear."},
    {setup: "What do you call an overthinking bike?", punchline: "Always stuck in the wrong gear."},
    {setup: "Why did the cyclist head to the hills?", punchline: "To get his mind into gear."},
    {setup: "How do cyclists solve big problems?", punchline: "They shift their thinking."},
    {setup: "Why was the racer so decisive?", punchline: "She was always in the right gear."},
    {setup: "What did the coach say to the sleepy rider?", punchline: "'Time to get in gear.'"},

    // ---- brake / break ----
    {setup: "Why did the cyclist quit for the afternoon?", punchline: "He needed a brake."},
    {setup: "What did the exhausted rider beg for?", punchline: "'Just give me a brake.'"},
    {setup: "Why can't racers relax?", punchline: "They can't brake the habit."},
    {setup: "Why did the bike get in trouble at work?", punchline: "It kept taking brakes."},
    {setup: "What did the squeaky bike shout?", punchline: "'Give me a brake, would you?'"},
    {setup: "Why was the descender so brave?", punchline: "She was never afraid to hit the brakes."},
    {setup: "Why did the bike see a counselor?", punchline: "It didn't know when to brake."},
    {setup: "What do worn-out brakes need most?", punchline: "A good, long brake."},

    // ---- handlebar / handle ----
    {setup: "Why are bicycles so honest?", punchline: "They just can't handlebar a lie."},
    {setup: "What do you call a cyclist who stays cool in a crisis?", punchline: "Someone who can really handlebar pressure."},
    {setup: "Why did the unicyclist feel left out?", punchline: "He had no handlebars to lean on."},
    {setup: "Why did the rookie panic on the descent?", punchline: "It was more than he could handlebar."},
    {setup: "What did the calm cyclist say in traffic?", punchline: "'Relax, I can handlebar this.'"},

    // ---- wheel / we'll / wheely ----
    {setup: "Why was the cyclist grinning ear to ear?", punchline: "He was wheely, wheely happy."},
    {setup: "What did one wheel promise the other?", punchline: "'Together, wheel go far.'"},
    {setup: "Why do cyclists make great teammates?", punchline: "They know wheel always finish together."},
    {setup: "Why are cyclists such optimists?", punchline: "They believe wheel get through anything."},
    {setup: "What did the bike say to cheer up its rider?", punchline: "'Don't worry, wheel figure it out.'"},
    {setup: "How did the bike propose on Valentine's Day?", punchline: "'I wheelie, wheelie love you.'"},
    {setup: "Why did the comedian buy a bike?", punchline: "He heard it was wheely funny."},

    // ---- pedal / peddle ----
    {setup: "What do you call a door-to-door salesman on a bike?", punchline: "A pedal pusher."},
    {setup: "Why did the cyclist get in trouble?", punchline: "He was caught pedaling stories."},
    {setup: "Why was the commuter so productive?", punchline: "He just kept pedaling through."},
    {setup: "What did the coach yell at the finish?", punchline: "'Put the pedal to the metal!'"},
    {setup: "Why did the cyclist pack extra snacks?", punchline: "To keep the pedal power going."},
    {setup: "What did the tired legs tell the rider?", punchline: "'No more pedaling, please.'"},

    // ---- saddle / seat ----
    {setup: "Why did the cowboy take up cycling?", punchline: "He loved to saddle up each morning."},
    {setup: "What did the bike say before the group ride?", punchline: "'Hop on, let's saddle up.'"},
    {setup: "Why was the new saddle so confident?", punchline: "It knew everyone would warm up to it."},
    {setup: "Why did the sore rider stand on the climb?", punchline: "He couldn't saddle the thought of sitting."},

    // ---- recycle / cycle-path ----
    {setup: "Why does the cyclist ride through the junkyard?", punchline: "He's a committed re-cycler."},
    {setup: "What do you call a menace on the bike trail?", punchline: "A cycle-path."},
    {setup: "Why did the green rider start a club?", punchline: "To recycle some old friends."},
    {setup: "What do you call riding the same loop again?", punchline: "Recycling."},
    {setup: "Why did the eco-cyclist feel proud?", punchline: "Every trip was a fresh cycle."},

    // ---- pump / fork / frame / tube / valve / hub / crank ----
    {setup: "Why did the cyclist bring a pump to the party?", punchline: "To liven things up."},
    {setup: "What did the flat tire tell the floor pump?", punchline: "'You really lift me up.'"},
    {setup: "Why was the road a tough decision for the rider?", punchline: "It came down to a big fork."},
    {setup: "Why was the frame so dependable?", punchline: "It always held itself together."},
    {setup: "Why did the cyclist love his old frame?", punchline: "It really had good bones."},
    {setup: "Where do bikes love to hang out?", punchline: "The hub of activity."},
    {setup: "Why was the mechanic grumpy at dawn?", punchline: "He hadn't had his morning crank."},
    {setup: "Why did the crank get a raise?", punchline: "It really turned things around."},
    {setup: "What do you call a bike part with a temper?", punchline: "A crank."},
    {setup: "Why did the valve stay quiet?", punchline: "It didn't want to let anything slip."},
    {setup: "Why did the seatpost get compliments?", punchline: "It really knew how to hold its position."},

    // ---- bearings / lost ----
    {setup: "Why did the cyclist see a therapist?", punchline: "He'd completely lost his bearings."},
    {setup: "Why was that wheel so smooth?", punchline: "It had all its bearings in order."},
    {setup: "Why did the tourist cyclist stop for directions?", punchline: "He was fresh out of bearings."},

    // ---- hills / climbing / descents ----
    {setup: "Why did the cyclist dislike the big hill?", punchline: "It always looked down on him."},
    {setup: "What's a climber's least favorite lie?", punchline: "'It's all downhill from here.'"},
    {setup: "Why do climbers appreciate gravity?", punchline: "It keeps them grounded."},
    {setup: "Why did the cyclist pack a jacket for the summit?", punchline: "For the chilly descent."},
    {setup: "What did the mountain say to the cyclist?", punchline: "'You'll never get over me.'"},
    {setup: "Why did the climber bring a book?", punchline: "The ascent took a chapter or two."},
    {setup: "Why was the descent so honest?", punchline: "It never held anything back."},

    // ---- wind / weather ----
    {setup: "Why did the cyclist argue with the wind?", punchline: "It kept pushing back."},
    {setup: "What did the headwind tell the rider?", punchline: "'You're going nowhere fast.'"},
    {setup: "Why do cyclists love a good tailwind?", punchline: "It's the only free speed in town."},
    {setup: "Why did the rider thank the crosswind?", punchline: "For keeping him on his toes."},
    {setup: "What's a cyclist's favorite kind of weather report?", punchline: "'Calm with a chance of PRs.'"},

    // ---- racing / drafting / sprint ----
    {setup: "Why did the racer study the wind so closely?", punchline: "To get the perfect draft."},
    {setup: "How did the cyclist win by so little?", punchline: "He edged ahead by a single spoke."},
    {setup: "Why did the sprinter lose the group ride?", punchline: "He peaked way too early."},
    {setup: "Why did the racer bring a pencil to the start?", punchline: "In case he had to draft."},
    {setup: "Why did the breakaway feel lonely?", punchline: "Nobody would come along for the ride."},
    {setup: "What do you call a rider who never takes a turn at the front?", punchline: "A wheel sucker with great manners."},
    {setup: "Why was the domestique so beloved?", punchline: "He always put the team first."},

    // ---- Strava / stats / N+1 ----
    {setup: "Why did the cyclist upload every single ride?", punchline: "If it's not online, it didn't happen."},
    {setup: "How many bikes does a cyclist really need?", punchline: "Just one more than they currently own."},
    {setup: "Why did the cyclist buy yet another bike?", punchline: "The correct number is always N plus one."},
    {setup: "Why was the rider late leaving the house?", punchline: "He couldn't decide which bike to ride."},
    {setup: "Why did the cyclist chase the segment again?", punchline: "The crown was calling his name."},

    // ---- coffee / kit / culture ----
    {setup: "Why do cyclists really go on group rides?", punchline: "The coffee stop, obviously."},
    {setup: "What fuels a cyclist more than carbs?", punchline: "A good espresso and a tailwind."},
    {setup: "What's a road cyclist's uniform?", punchline: "Lycra and unshakable confidence."},
    {setup: "Why did the cyclist buy matching kit?", punchline: "Looking fast is half the battle."},
    {setup: "Why did the cyclist shave his legs?", punchline: "Purely aerodynamic reasons, of course."},

    // ---- indoor / trainer / virtual ----
    {setup: "Why did the cyclist ride indoors all winter?", punchline: "The weather couldn't spoke his plans."},
    {setup: "What do you call a bike that goes nowhere fast?", punchline: "A turbo trainer."},
    {setup: "Why was the indoor cyclist drenched?", punchline: "There's no coasting on a trainer."},
    {setup: "Why did the cyclist join the virtual race?", punchline: "To draft from his living room."},
    {setup: "Why don't turbo trainers get lonely?", punchline: "They've always got a screen full of friends."},
    {setup: "Why did the rider love the virtual world?", punchline: "It never rains on a group ride there."},

    // ---- mountain / gravel / BMX ----
    {setup: "Why did the mountain biker carry a map?", punchline: "He kept losing his bearings."},
    {setup: "What do you call a mountain biker who never crashes?", punchline: "Suspiciously lucky."},
    {setup: "Why did the gravel rider pack so many snacks?", punchline: "It's a long way between anywhere."},
    {setup: "Why was the BMX rider always chill?", punchline: "He just knew how to roll with it."},
    {setup: "Why did the downhiller skip breakfast?", punchline: "He likes to ride on empty."},
    {setup: "Why did the trail rider bring a comb?", punchline: "For all the gnarly sections."},

    // ---- bell / basket / reflector / kickstand / mudguard ----
    {setup: "Why did the bike ring its bell?", punchline: "It just wanted to be heard."},
    {setup: "What did the polite bike do at the crossing?", punchline: "It gave a little ring."},
    {setup: "Why did the bike get a basket?", punchline: "To carry its own weight."},
    {setup: "Why was the reflector invited everywhere?", punchline: "It really brightened the room."},
    {setup: "Why was the kickstand so reliable?", punchline: "It always took a stand."},
    {setup: "Why did the kickstand feel unappreciated?", punchline: "It was always left holding everything up."},
    {setup: "Why did the mudguard blush?", punchline: "It saw the road get filthy."},
    {setup: "Why did the bell win the popularity contest?", punchline: "It had a lovely ring to it."},

    // ---- misc wordplay ----
    {setup: "What do you call a bicycle comedian?", punchline: "A wheely funny guy."},
    {setup: "Why don't bikes tell good jokes?", punchline: "They always fall flat."},
    {setup: "What do you call two bikes that are best friends?", punchline: "Spoke-mates."},
    {setup: "Why was the old bike so wise?", punchline: "It had been around the block a few times."},
    {setup: "Why did the cyclist win the debate?", punchline: "He had solid spokes to back him up."},
    {setup: "Why did the bicycle go to the doctor?", punchline: "It had a nasty case of spoke-itis."},
    {setup: "Why did the bike blush on the descent?", punchline: "It couldn't help admiring the curves."},
    {setup: "What did the bike say to its rider at bedtime?", punchline: "'Wheel see each other tomorrow.'"},
    {setup: "Why did the cyclist keep a diary?", punchline: "To record his cycle of thoughts."},
    {setup: "What's the most patient part of a bike?", punchline: "The wheel — it just keeps coming around."},
    {setup: "Why did the bike refuse to argue?", punchline: "It didn't want to spoke a fight."},
    {setup: "Why was the tandem such a happy couple?", punchline: "They never rode off in different directions."},
    {setup: "Why did the tandem team break up?", punchline: "They just weren't pulling their weight."},
    {setup: "What do you call a very polite cyclist?", punchline: "Someone who always yields the path."},
    {setup: "Why did the bike enroll in art class?", punchline: "It wanted to draw a few good circles."},
    {setup: "Why did the wheel get a standing ovation?", punchline: "It really knew how to roll with the crowd."},
    {setup: "What did the finish line say to the sprinter?", punchline: "'You've been racing to see me all day.'"},
    {setup: "Why did the bike bring a suitcase?", punchline: "It was going on a long tour."},
    {setup: "What do you call a bike that plays music?", punchline: "A spoke-box."},
    {setup: "Why did the cyclist plant a garden?", punchline: "He wanted his fitness to grow in cycles."},
    {setup: "Why was the peloton so calm?", punchline: "Everyone knew their place in line."},
    {setup: "Why did the new rider love the bunch?", punchline: "There's always a wheel to follow."},
    {setup: "Why did the cyclist bring tape to the race?", punchline: "In case things came down to the wire."},
    {setup: "Why did the bike lane feel important?", punchline: "Everyone was drawn to it."},
    {setup: "What did the wise old cyclist say?", punchline: "'Life's like a bike — keep pedaling or you fall.'"},
    {setup: "Why did the helmet get promoted?", punchline: "It was always using its head."},
    {setup: "Why did the helmet feel underrated?", punchline: "It always had the rider's back — and top."},
    {setup: "Why did the cyclist trust his water bottle?", punchline: "It never left him high and dry."},
    {setup: "Why did the bottle cage feel needy?", punchline: "It just wanted something to hold."},
    {setup: "What do you call a cyclist who tells tall tales?", punchline: "A spinner."},
    {setup: "Why is spin class so honest?", punchline: "Nobody there is just coasting."},
    {setup: "Why did the cyclist love roundabouts?", punchline: "Life is all about cycles."},
    {setup: "Why did the bike apply for a loan?", punchline: "It was a little short on a few links."},
    {setup: "Why did the wheel get a job in sales?", punchline: "It really knew how to turn a deal."},
    {setup: "Why was the cyclist great at chess?", punchline: "He always thought several gears ahead."},
    {setup: "Why did the derailleur go to school?", punchline: "It wanted to make the right shift in life."},
    {setup: "What did the derailleur say under stress?", punchline: "'I'm shifting as fast as I can!'"},
    {setup: "Why was the cassette so popular?", punchline: "It had a range for every mood."},
    {setup: "Why did the cleat feel connected?", punchline: "It always clicked with the pedal."},
    {setup: "Why did the clipless pedal apologize?", punchline: "It hated to see anyone fall."},
    {setup: "What did the new cyclist say after clipping in?", punchline: "'We really click.'"},
    {setup: "Why did the bike computer get invited to parties?", punchline: "It always kept track of the fun."},
    {setup: "Why did the odometer never lie?", punchline: "It always went the distance."},
    {setup: "Why did the cyclist befriend the hill?", punchline: "He liked a relationship with ups and downs."},
    {setup: "Why did the road bike look down on the beach cruiser?", punchline: "It was too laid back for its taste."},
    {setup: "Why was the beach cruiser so happy?", punchline: "It never let anything drive it up a hill."},
    {setup: "Why did the folding bike stay humble?", punchline: "It always knew when to fold."},
    {setup: "Why did the e-bike get teased?", punchline: "Some riders found it a bit re-volt-ing."},
    {setup: "Why did the e-bike win the argument?", punchline: "It had all the power."},
    {setup: "What did the battery tell the e-bike?", punchline: "'I've got you charged for the day.'"},
    {setup: "Why was the cyclist so grounded?", punchline: "He never got carried away on the flats."},
    {setup: "Why did the wheel go to yoga?", punchline: "To stay perfectly balanced."},
    {setup: "Why did the cyclist bring a broom?", punchline: "He heard the course needed a clean sweep."},
    {setup: "Why did the pedal love its job?", punchline: "It got a real kick out of it."},
    {setup: "Why did the pedals argue?", punchline: "They kept going in circles."},
    {setup: "Why did the cyclist smile at the puncture repair kit?", punchline: "It always had his back in a jam."},
    {setup: "What did the patch say to the tube?", punchline: "'Stick with me and we'll be fine.'"},
    {setup: "Why did the bike lock feel secure?", punchline: "It had serious commitment issues — in a good way."},
    {setup: "Why did the cyclist thank the tailgate?", punchline: "For always giving him a lift."},
    {setup: "Why did the wheel become a philosopher?", punchline: "It kept coming full circle."},
    {setup: "Why did the cyclist enjoy the rain ride?", punchline: "He was on a bit of a roll."},
    {setup: "Why was the rim so proud?", punchline: "It kept everything true."},
    {setup: "Why did the true wheel never gossip?", punchline: "It refused to get out of line."},
    {setup: "Why did the cyclist take up baking?", punchline: "He wanted to work on his rolls."},
    {setup: "Why did the group ride love the newbie?", punchline: "He brought a fresh set of legs."},
    {setup: "Why did the cyclist trust his legs?", punchline: "They always came through in a pinch."},
    {setup: "Why did the sprinter love the last 200 meters?", punchline: "That's where he really came alive."},
    {setup: "Why did the time trialist ride alone?", punchline: "It was a race of truth."},
    {setup: "Why did the cyclist bring a calendar to the ride?", punchline: "He wanted to make every day count."},
    {setup: "Why did the tire and the road stay friends?", punchline: "They always had good contact."},
    {setup: "Why did the cyclist love the smooth tarmac?", punchline: "It was a real feel-good story."},
    {setup: "Why did the pothole get a bad reputation?", punchline: "It let everyone down."},
    {setup: "Why did the cyclist high-five the finish arch?", punchline: "They finally reached an understanding."},
    {setup: "Why was the bike bell so wise?", punchline: "It always knew the right time to speak up."},
    {setup: "Why did the cyclist forgive the flat?", punchline: "Everyone deserves a second inflation."},
];
