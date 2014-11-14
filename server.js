var config = require('config'),
    util = require('util');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));

app.use(client.middleware());
app.get('/box', function(req, res, next) {
    res.send({boxOpen: boxOpen});
});
app.listen(config.get("http.port"));

var users = {};
var waitingQueue = [];
var conversations = {};
var boxOpen = false;

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
            "master": true,
            "command": msg.Body
        };
    }
    return users[msg.from];
}

function deactivateUser(user) {
    user.active = false;
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

    function sendMessageToUser(messageText) {
        for(user in users) {
            app.sendSMS(config.get("app.serviceNumber"), user.number, messageText, function (err, msg) {
            if (err) {
                console.log(err);
            }
            logConversation(user, "SENT", messageText);
        });
      }
    }

    app.on('incomingSMSMessage', function(msg) {
        var user = getUser(msg);
        if (user == undefined) {
            user = createUser(msg);
            sendMessageToUser(user, "Did all " + users.length + " people follow your command? Reply with 'quit' to quit.");
            sendCommandToEveryone(msg.Body);
        } else if (msg.Body.toLowerCase() == "quit") {
            deactivateUser(user);
            return;
        } else {
            if (msg.Body.toLowerCase().indexOf("y") != -1) {
                openBox();
            }
        }
        logConversation(user, "RECV", msg.Body);
    });
});
