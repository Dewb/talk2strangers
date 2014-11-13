var config = require('config');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));

app.use(client.middleware());
app.listen(config.get("http.port"));

var users = {};
var waitingQueue = [];
var conversations = {};

function getUser(msg) {
    return users[msg.From];
}

function createUser(msg) {
    var number = msg.From;
    if (!(number in users)) {
        users[number] = { 
            "number": number,
            "joined": new Date(),
            "active": false,
            "stranger": undefined,
            "greeting": msg.Body,
            "firstTime": true
        };
    }
    return users[msg.from];
}

function deactivateUser(user) {
    user.active = false;
    if (user.stranger != undefined) {
        user.stranger.stranger = undefined;
        user.stranger = undefined;
    }
}

function logConversation(user, direction, messageText) {
    if (!(user.number in conversations)) {
        conversations[user.number] = [];
    }
    var c = conversations[user.number];
    c.push([direction, messageText]);
    console.log(user.number + " " + direction + " " + messageText);
}

console.log("                   _                                        ");
console.log(" _|_  _,  |\\ |)   / )  , _|_  ,_   _,         _,  _  ,_   ,  ");
console.log("  |  / |  |/ |/)   /  / \\_|  /  | / |  /|/|  / | |/ /  | / \\_");
console.log("  |_/\\/|_/|_/| \\/ /__  \\/ |_/   |/\\/|_/ | |_/\\/|/|_/   |/ \\/ ");
console.log("                                              (|             ");

client.account.getApplication(config.get("twilio.applicationSid"), function(err, app) {
    if (err) {
        throw err;
    }
    app.register();
    console.log("Application registered");

    function sendMessageToUser(user, messageText) {
        if (!user.active) {
            console.log("Tried to send message to inactive user!");
            return;
        }
        app.sendSMS(config.get("app.serviceNumber"), user.number, messageText, function (err, msg) {
            if (err) {
                console.log(err);
            }
            logConversation(user, "SENT", messageText);
        });
    }

    function queueUserForConversation(user) {
        if (waitingQueue.indexOf(user) == -1) {
            waitingQueue.push(user);
        }

        if (waitingQueue.length >= 2) {
            connectStrangers(waitingQueue.shift(), waitingQueue.shift());
        }
    }

    function connectStrangers(user1, user2) {
        user1.stranger = user2;
        user2.stranger = user1;

        logConversation(user1, "SYSTEM", "New conversation with " + user2.number)
        logConversation(user2, "SYSTEM", "New conversation with " + user1.number)

        sendMessageToUser(user1, config.get("text.newConversationMessage"));
        sendMessageToUser(user1, user2.greeting);
        sendMessageToUser(user2, config.get("text.newConversationMessage"));
        sendMessageToUser(user2, user1.greeting);
    }

    function relayConversationToStranger(user, messageText) {
        sendMessageToUser(user.stranger, messageText);
    }

    app.on('incomingSMSMessage', function(msg) {
        var user = getUser(msg);
        if (user == undefined) {
            user = createUser(msg);
            sendMessageToUser(user, config.get("text.newUserMessage"));
            queueUserForConversation(user);
        } else if (msg.Body.toLowerCase() == "quit") {
            deactivateUser(user);
            return;
        } else if (msg.Body.toLowerCase() == "new") {
            queueUserForConversation(user);
            return;
        } else if (user.stranger != undefined) {
            relayConversationToStranger(user, msg.Body)
        } 
        logConversation(user, "RECV", msg.Body);
    });
});