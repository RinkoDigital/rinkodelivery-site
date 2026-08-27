function updateTotal() {
  const size = document.getElementById("size").value;
  const distance = parseFloat(document.getElementById("distance").value) || 0;

  let base = 5;
  if (size === "medium") base = 8;
  if (size === "large") base = 12;

  const pricePerMile = 2.10;

  let total = base + (distance * pricePerMile);

  document.getElementById("total").innerText = "$" + total.toFixed(2);
}

updateTotal();
