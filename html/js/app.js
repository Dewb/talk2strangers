var items = [];

$.getJSON('http://talk.dewb.org/chatter', function(data) {
  $.each(data, function(key, val) {
    items.push(val);
  });
});

for (var i=0; i < items.length; i++) {
  var command = document.createElement('div');
  var clear = document.createElement('div');
  command.className = 'from-them';
  clear.className = 'clear';
  command.innerHTML = '<p>' + items[i] + '</p>';
  
  document.getElementById('commands').appendChild(command);
  document.getElementById('commands').appendChild(clear);
}
