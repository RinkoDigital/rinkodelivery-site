function updateTotal() {
  const size = document.getElementById("size").value;
  const distance = parseFloat(document.getElementById("distance").value) || 0;

  let base = 10;
  if (size === "medium") base = 15;
  if (size === "large") base = 20;

  const pricePerMile = 2.10;

  let total = base + (distance * pricePerMile);

  document.getElementById("total").innerText = "$" + total.toFixed(2);
}

updateTotal();
