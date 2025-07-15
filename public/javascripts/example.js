document.addEventListener('DOMContentLoaded', function() {
  fetch('/api/example')
    .then(response => response.json())
    .then(data => {
      const el = document.getElementById('example-data');
      if (el) {
        el.textContent = JSON.stringify(data, null, 2);
      }
    })
    .catch(err => {
      const el = document.getElementById('example-data');
      if (el) {
        el.textContent = 'Error fetching data: ' + err;
      }
    });
}); 