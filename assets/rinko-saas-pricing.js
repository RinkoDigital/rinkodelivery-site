// RINKO DELIVERY — SAAS PRICING ENGINE
// Add this to index.html and order.html after rinko-saas-config.js.

window.RinkoSaaSPricing = {
  settings: null,
  coupons: [],

  async load() {
    const client = window.rinkoClient;
    if (!client) {
      console.warn("Rinko SaaS: Supabase client not found.");
      return;
    }

    const { data: settings, error: settingsError } = await client
      .from("rinko_settings")
      .select("*")
      .eq("id", "main")
      .single();

    if (settingsError) console.warn("Settings load error:", settingsError.message);
    this.settings = settings || {
      small_base: 10,
      medium_base: 15,
      large_base: 20,
      per_mile: 2.10,
      express_fee: 15,
      heavy_fee: 15,
      senior_internal_code: "SENIORHEAVY",
      minimum_price: 0
    };

    const { data: coupons, error: couponError } = await client
      .from("rinko_coupons")
      .select("*")
      .eq("active", true);

    if (couponError) console.warn("Coupons load error:", couponError.message);
    this.coupons = coupons || [];
  },

  getBaseBySize(size) {
    const s = String(size || "small").toLowerCase();
    if (s.includes("medium")) return Number(this.settings.medium_base);
    if (s.includes("large")) return Number(this.settings.large_base);
    return Number(this.settings.small_base);
  },

  findCoupon(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return null;

    const now = new Date();

    return this.coupons.find(c => {
      const same = String(c.code).toUpperCase() === normalized;
      const active = c.active === true;
      const notExpired = !c.expires_at || new Date(c.expires_at) > now;
      const underLimit = !c.usage_limit || Number(c.used_count || 0) < Number(c.usage_limit);
      return same && active && notExpired && underLimit;
    }) || null;
  },

  calculate({ size = "small", miles = 1, speed = "standard", weight = "", couponCode = "", internalCode = "" }) {
    const base = this.getBaseBySize(size);
    const perMile = Number(this.settings.per_mile || 2.10);
    const expressFee = String(speed).toLowerCase().includes("express") ? Number(this.settings.express_fee || 15) : 0;

    const isHeavy = String(weight).toLowerCase().includes("over 20") || String(weight).toLowerCase().includes("heavy");
    const isSeniorInternal = String(internalCode || "").trim().toUpperCase() === String(this.settings.senior_internal_code || "SENIORHEAVY").toUpperCase();

    const heavyFee = isHeavy && !isSeniorInternal ? Number(this.settings.heavy_fee || 15) : 0;

    const coupon = this.findCoupon(couponCode);
    const discountPercent = coupon ? Number(coupon.discount_percent || 0) : 0;

    const subtotal = base + (Number(miles || 0) * perMile) + expressFee + heavyFee;
    let total = subtotal - (subtotal * (discountPercent / 100));

    // No minimum price: total follows exact formula.

    return {
      base,
      perMile,
      expressFee,
      heavyFee,
      discountPercent,
      subtotal,
      total,
      couponApplied: coupon ? coupon.code : "",
      seniorHeavyWaived: isHeavy && isSeniorInternal
    };
  }
};
