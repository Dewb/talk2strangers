var config = require('config');
var express = require('express'),
    app = express();
var twilio = require('twilio-api'),
    client = new twilio.Client(config.get("twilio.accountSid"), config.get("twilio.authToken"));

app.use(client.middleware());
app.listen(config.get("twilio.port"));

client.account.getApplication(config.get("twilio.applicationSid"), function(err, app) {
    if (err) {
        throw err;
    }
    app.register();
});