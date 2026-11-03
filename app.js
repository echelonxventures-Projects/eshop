import {PlatformContext} from './platform.js';

const platform = new PlatformContext();
const apiBase = document.querySelector('meta[name="platform-api-base"]')?.content || '/api';
const sessionKey = 'marketly-session';

let products = [
  {id:'p1',category:'home',title:'Linen & Clay Table Lamp',price:68,oldPrice:84,rating:4.8,reviews:124,tag:'BESTSELLER',image:'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80',description:'A warm, sculptural glow for slow mornings and late-night pages. Handmade ceramic base with a natural linen shade.',flags:['bestseller']},
  {id:'p2',category:'tech',title:'Pebble Wireless Headphones',price:129,oldPrice:159,rating:4.9,reviews:362,tag:'TOP RATED',image:'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',description:'Immersive sound, all-day comfort, and 40 hours of battery life in a beautifully simple silhouette.',flags:['bestseller']},
  {id:'p3',category:'style',title:'Everyday Canvas Tote',price:34,oldPrice:null,rating:4.7,reviews:89,tag:'NEW IN',image:'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80',description:'Your new carry-everything companion, crafted from sturdy recycled canvas and finished with vegetable-tanned leather.',flags:['new']},
  {id:'p4',category:'wellness',title:'Matcha Ritual Starter Kit',price:42,oldPrice:52,rating:4.9,reviews:207,tag:'EDITOR\'S PICK',image:'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?auto=format&fit=crop&w=600&q=80',description:'Everything you need for a calmer cup: ceremonial-grade matcha, a bamboo whisk, scoop, and a little ritual guide.',flags:['bestseller']},
  {id:'p5',category:'home',title:'Oatmeal Waffle Throw',price:76,oldPrice:null,rating:4.6,reviews:51,tag:'NEW IN',image:'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=600&q=80',description:'Textured, breathable comfort woven from a soft cotton-linen blend. The perfect extra layer for the sofa.',flags:['new']},
  {id:'p6',category:'tech',title:'Arc Desk Charging Dock',price:54,oldPrice:69,rating:4.5,reviews:73,tag:'LIMITED DROP',image:'https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=600&q=80',description:'One elegant home for your phone, watch, and earbuds. The weighted aluminum base keeps every cable in place.',flags:['new']},
  {id:'p7',category:'style',title:'Ribbed Cloud Socks · 3 pack',price:22,oldPrice:null,rating:4.8,reviews:145,tag:'BESTSELLER',image:'https://images.unsplash.com/photo-1582966772680-860e372bb558?auto=format&fit=crop&w=600&q=80',description:'The soft, ribbed socks you will reach for every day. A breathable cotton blend in three easy neutrals.',flags:['bestseller']},
  {id:'p8',category:'wellness',title:'Sandalwood + Fig Candle',price:28,oldPrice:35,rating:4.7,reviews:118,tag:'BESTSELLER',image:'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=600&q=80',description:'A slow, clean burn with notes of sun-warmed sandalwood, ripe fig, and a hint of cedar.',flags:['bestseller']},
  {id:'p9',category:'home',title:'Sunday Stoneware Mug',price:24,oldPrice:null,rating:4.9,reviews:318,tag:'TOP RATED',image:'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=600&q=80',description:'A generously sized mug with a hand-finished glaze, made for the first coffee of the day.',flags:['new','bestseller']},
  {id:'p10',category:'tech',title:'Mini Focus Speaker',price:89,oldPrice:110,rating:4.4,reviews:42,tag:'NEW IN',image:'https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=600&q=80',description:'A compact speaker with rich, room-filling sound and a fabric finish that belongs in any room.',flags:['new']},
  {id:'p11',category:'style',title:'Soft Structure Cap',price:27,oldPrice:null,rating:4.6,reviews:64,tag:'NEW IN',image:'https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=600&q=80',description:'A low-profile cap with a washed finish and a comfortable adjustable strap.',flags:['new']},
  {id:'p12',category:'wellness',title:'Daily Reset Journal',price:18,oldPrice:null,rating:4.8,reviews:96,tag:'BESTSELLER',image:'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=600&q=80',description:'A guided 90-day journal for making space, setting intentions, and noticing the good stuff.',flags:['bestseller']}
];

const deals = [
  {title:'Cloud-touch bath towels',price:29,oldPrice:44,discount:'34% off',image:'https://images.unsplash.com/photo-1583845112203-454c58e72b5f?auto=format&fit=crop&w=600&q=80',sold:'72% claimed'},
  {title:'Cedar + smoke candle duo',price:24,oldPrice:38,discount:'37% off',image:'https://images.unsplash.com/photo-1608181831718-c9e2f7f4a6ee?auto=format&fit=crop&w=600&q=80',sold:'58% claimed'},
  {title:'The soft knit cardigan',price:48,oldPrice:76,discount:'36% off',image:'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=600&q=80',sold:'81% claimed'},
  {title:'Brew better coffee set',price:39,oldPrice:59,discount:'34% off',image:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=80',sold:'46% claimed'}
];

let departments = [
  {name:'Home & living',category:'home',image:'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=500&q=80'},
  {name:'Tech & gadgets',category:'tech',image:'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=500&q=80'},
  {name:'Style & apparel',category:'style',image:'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=500&q=80'},
  {name:'Wellness',category:'wellness',image:'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=500&q=80'},
  {name:'Kitchen',category:'home',image:'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=500&q=80'},
  {name:'Outdoors',category:'style',image:'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=500&q=80'}
];

const state = {cart: JSON.parse(localStorage.getItem('marketly-cart') || '{}'), wishlists: JSON.parse(localStorage.getItem('marketly-wishlist') || '[]'), session: JSON.parse(localStorage.getItem(sessionKey) || 'null'), checkoutKey:null, search:'', searchCategory:'all', category:'all', tab:'all', departments:[], rating:0, price:'all', sort:'featured', visible:8};
const $ = (selector, parent=document) => parent.querySelector(selector);
const $$ = (selector, parent=document) => [...parent.querySelectorAll(selector)];
const money = value => platform.formatMoney(value);
const categoryName = value => ({home:'Home',tech:'Tech',style:'Style',wellness:'Wellness'}[value] || value);

async function loadExperience(){
  const apiBase = document.querySelector('meta[name="platform-api-base"]')?.content || '/api';
  const context = platform.context;
  try {
    const response = await fetch(`${apiBase}/experience`, {headers:{'x-tenant-id':context.tenant.id,'x-universe-id':context.universe.id,'x-locale':context.locale.id,'x-currency':context.currency.id}});
    if(!response.ok) return;
    const payload = await response.json();
    applyExperience(payload.data.experience);
  } catch { /* The static shell remains usable when the API is unavailable. */ }
}

function applyExperience(experience = {}){
  const branding = experience.branding || {};
  const content = experience.content || {};
  const legal = experience.legal || {};
  if(branding.name){document.title = branding.name;$$('[data-brand-name]').forEach(element => element.textContent = branding.name.toLowerCase());}
  if(branding.shortName) $$('[data-brand-mark]').forEach(element => element.textContent = branding.shortName);
  if(branding.logoUrl) $$('[data-brand-mark]').forEach(element => {element.textContent='';element.style.backgroundImage=`url(${branding.logoUrl})`;element.style.backgroundSize='cover';});
  if(branding.faviconUrl){let favicon=document.querySelector('link[rel="icon"]');if(!favicon){favicon=document.createElement('link');favicon.rel='icon';document.head.appendChild(favicon);}favicon.href=branding.faviconUrl;}
  if(content.announcement){const split = content.announcement.split(':');const prefix = $('[data-experience="announcement-prefix"]');const announcement = $('[data-experience="announcement"]');if(prefix && announcement && split.length > 1){prefix.textContent = `${split.shift()}:`;announcement.textContent = split.join(':').trim();}else if(announcement) announcement.textContent = content.announcement;}
  for(const key of ['heroEyebrow','heroDescription','footerTagline']) if(content[key]) $$(`[data-experience="${key}"]`).forEach(element => element.textContent = content[key]);
  if(content.heroTitle) $$('[data-experience="heroTitle"]').forEach(element => element.textContent = content.heroTitle);
  if(Array.isArray(content.deals)) renderDeals(content.deals);
  if(Array.isArray(content.departments)) renderDepartments(content.departments);
  if(legal.companyName) $$('[data-experience="companyName"]').forEach(element => element.textContent = `© ${new Date().getFullYear()} ${legal.companyName}`);
  if(legal.privacyLabel || legal.termsLabel || legal.accessibilityLabel) $$('[data-experience="legalLinks"]').forEach(element => element.textContent = [legal.privacyLabel,legal.termsLabel,legal.accessibilityLabel].filter(Boolean).join(' · '));
  const root = document.documentElement;
  for(const [key, variable] of [['primaryColor','--orange'],['primaryColor','--orange-dark'],['accentColor','--teal'],['darkColor','--ink'],['surfaceColor','--cream']]) if(branding[key]) root.style.setProperty(variable, branding[key]);
  if(branding.fontFamily) root.style.setProperty('--body-font', branding.fontFamily);
  if(branding.displayFontFamily) root.style.setProperty('--display-font', branding.displayFontFamily);
}

function renderContextControls(){
  const tenantSelect = $('#tenant-select');
  const universeSelect = $('#universe-select');
  const languageSelect = $('#language-select');
  const currencySelect = $('#currency-select');
  if(!tenantSelect) return;
  tenantSelect.innerHTML = platform.definition.tenants.map(item => `<option value="${item.id}" ${item.id === platform.state.tenant ? 'selected' : ''}>${item.label}</option>`).join('');
  universeSelect.innerHTML = platform.definition.universes.filter(item => platform.tenant.universes.includes(item.id)).map(item => `<option value="${item.id}" ${item.id === platform.state.universe ? 'selected' : ''}>${item.label}</option>`).join('');
  languageSelect.innerHTML = platform.definition.locales.filter(item => platform.tenant.locales.includes(item.id)).map(item => `<option value="${item.id}" ${item.id === platform.state.locale ? 'selected' : ''}>${item.label}</option>`).join('');
  currencySelect.innerHTML = platform.currencyOptions().map(item => `<option value="${item.id}" ${item.id === platform.state.currency ? 'selected' : ''}>${item.label}</option>`).join('');
}

function applyContext(){
  const context = platform.context;
  document.documentElement.lang = context.locale.id;
  const searchInput = $('#search-input');
  if(searchInput) searchInput.placeholder = platform.t('search');
  const locationLabel = $('.location-control small');
  if(locationLabel) locationLabel.textContent = platform.t('deliverTo');
  const cartLabel = $('.cart-button strong');
  if(cartLabel) cartLabel.textContent = platform.t('cart');
  const navLinks = $$('.nav-links a');
  if(navLinks.length >= 3){navLinks[0].textContent = platform.t('deals');navLinks[1].textContent = platform.t('departments');navLinks[2].textContent = platform.t('recommendations');}
  const heroButton = $('.hero-actions .button-primary');
  if(heroButton) heroButton.innerHTML = `${platform.t('startExploring')} <span>→</span>`;
  const recommendationTitle = $('#recommended h2');
  if(recommendationTitle) recommendationTitle.innerHTML = `${platform.t('pickedFor').replace('your world','')}<em>${context.locale.id.startsWith('en') ? 'your world' : ''}</em>`;
  const footerLocale = $('.footer-locale');
  if(footerLocale) footerLocale.textContent = `◎ ${context.tenant.label} / ${context.currency.id}`;
}

function renderDeals(items = deals){
  $('#deal-grid').innerHTML = items.map(deal => `<article class="deal-card"><div class="deal-card-image"><img src="${deal.image}" alt="${deal.title}" loading="lazy" /><span class="deal-badge">${deal.discount}</span></div><div class="deal-info"><h3>${deal.title}</h3><div class="deal-price">${money(deal.price)} <del>${money(deal.oldPrice)}</del></div><div class="deal-sold"><span></span></div><small>${deal.sold}</small></div></article>`).join('');
}

function renderDepartments(items = departments){
  $('#department-grid').innerHTML = items.map(dept => `<button class="department-card" data-category="${dept.category}"><img src="${dept.image}" alt="${dept.name}" loading="lazy" /><span>${dept.name}</span></button>`).join('');
}

function filteredProducts(){
  let result = products.filter(product => {
    const query = state.search.toLowerCase();
    const matchesSearch = !query || `${product.title} ${product.category} ${product.description}`.toLowerCase().includes(query);
    const matchesSearchCategory = state.searchCategory === 'all' || product.category === state.searchCategory;
    const matchesCategory = state.category === 'all' || product.category === state.category;
    const matchesDepartments = !state.departments.length || state.departments.includes(product.category);
    const matchesRating = !state.rating || product.rating >= state.rating;
    const matchesPrice = state.price === 'all' || (state.price === 'under25' && product.price < 25) || (state.price === '25to75' && product.price >= 25 && product.price <= 75) || (state.price === 'over75' && product.price > 75);
    const matchesTab = state.tab === 'all' || product.flags.includes(state.tab);
    return matchesSearch && matchesSearchCategory && matchesCategory && matchesDepartments && matchesRating && matchesPrice && matchesTab;
  });
  if(state.sort === 'price-low') result.sort((a,b) => a.price-b.price);
  if(state.sort === 'price-high') result.sort((a,b) => b.price-a.price);
  if(state.sort === 'rating') result.sort((a,b) => b.rating-a.rating);
  return result;
}

function productCard(product){
  const wished = state.wishlists.includes(product.id);
  return `<article class="product-card" data-product-id="${product.id}"><div class="product-image"><img src="${product.image}" alt="${product.title}" loading="lazy" /><span class="product-tag">${product.tag}</span><button class="wish-button ${wished ? 'active' : ''}" data-wishlist="${product.id}" aria-label="${wished ? 'Remove from wishlist' : 'Add to wishlist'}">${wished ? '♥' : '♡'}</button></div><div class="product-info"><span class="product-category">${categoryName(product.category)}</span><h3>${product.title}</h3><div class="rating"><span class="stars">★★★★★</span><small>${product.rating} (${product.reviews})</small></div><div class="product-bottom"><span class="product-price">${money(product.price)}<small>${product.oldPrice ? ` <del>${money(product.oldPrice)}</del>` : ''}</small></span><button class="add-button" data-add="${product.id}" aria-label="Add ${product.title} to cart">+</button></div></div></article>`;
}

function renderProducts(){
  const result = filteredProducts();
  const visible = result.slice(0,state.visible);
  $('#product-grid').innerHTML = visible.length ? visible.map(productCard).join('') : `<div class="empty-results"><h3>No finds yet.</h3><p>Try a different search or clear your filters.</p></div>`;
  $('#results-count').textContent = `Showing ${visible.length} of ${result.length || 0} results`;
  $('#loaded-count').textContent = visible.length;
}

function saveCart(){localStorage.setItem('marketly-cart', JSON.stringify(state.cart));}
function saveWishlist(){localStorage.setItem('marketly-wishlist', JSON.stringify(state.wishlists));}
function cartItems(){return Object.entries(state.cart).map(([id, quantity]) => ({product:products.find(product => product.id === id),quantity})).filter(item => item.product);}
function cartCount(){return cartItems().reduce((sum,item) => sum + item.quantity, 0);}
function contextHeaders(){const context = platform.context;return {'x-tenant-id':context.tenant.id,'x-universe-id':context.universe.id,'x-locale':context.locale.id,'x-currency':context.currency.id,'x-channel':'web'};}
async function apiRequest(path, options = {}){
  const headers = {...contextHeaders(),...(options.body ? {'content-type':'application/json'} : {}),...(options.headers || {})};
  if(state.session?.accessToken) headers.authorization = `Bearer ${state.session.accessToken}`;
  const response = await fetch(`${apiBase}${path}`, {...options,headers});
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if(response.status === 401 && state.session){clearSession();throw new Error('Your session has expired. Please sign in again.');}
  if(!response.ok) throw new Error(body?.error?.message || 'The request could not be completed.');
  return body;
}
function saveSession(){localStorage.setItem(sessionKey, JSON.stringify(state.session));}
function clearSession(){state.session=null;localStorage.removeItem(sessionKey);}
function setSession(payload){state.session={accessToken:payload.accessToken,refreshToken:payload.refreshToken,user:payload.user};saveSession();}
function productFromApi(item){const media = Array.isArray(item.media) ? item.media : [];return {id:item.id,category:item.category || 'all',title:item.title,price:Number(item.price),oldPrice:item.compareAtPrice === null ? null : Number(item.compareAtPrice),rating:Number(item.rating || 0),reviews:Number(item.reviewCount || 0),tag:'FEATURED',image:media[0]?.url || media[0] || '',description:item.description || '',flags:['new']};}
async function loadCatalog(){try{const [productPayload,categoryPayload] = await Promise.all([apiRequest('/catalog/products?pageSize=100'),apiRequest('/catalog/categories')]);if(productPayload?.data?.length){products = productPayload.data.map(productFromApi);renderProducts();}if(categoryPayload?.data?.length){const imageByCategory = Object.fromEntries(departments.map(item => [item.category,item.image]));departments = categoryPayload.data.map(category => ({name:category.name,category:category.slug,image:imageByCategory[category.slug] || departments[0]?.image || ''}));renderDepartments();}}catch { /* Static catalog remains available when the API is not running. */ }}
async function syncCartFromServer(guestCart = null){if(!state.session) return;try{const payload = await apiRequest('/cart');const serverItems = Object.fromEntries((payload.data.items || []).map(item => [item.product_id, item.quantity]));if(guestCart){for(const [productId, quantity] of Object.entries(guestCart)){const mergedQuantity = (serverItems[productId] || 0) + quantity;await apiRequest('/cart/items',{method:'POST',body:JSON.stringify({productId,quantity:mergedQuantity})});serverItems[productId] = mergedQuantity;}}state.cart = serverItems;saveCart();renderCart();}catch { /* Keep the local cart if the API is unavailable. */ }}

function renderCart(){
  const items = cartItems();
  const count = cartCount();
  $('#cart-count').textContent = count;
  $('#drawer-count').textContent = count;
  if(!items.length){
    $('#cart-content').innerHTML = `<div class="empty-cart"><div class="empty-cart-icon">♡</div><h3>Your bag is waiting.</h3><p>When you find something lovely, it will show up here.</p><button class="button button-primary" data-action="continue-shopping">Keep exploring <span>→</span></button></div>`;
    $('#cart-footer').innerHTML = '';
    return;
  }
  $('#cart-content').innerHTML = items.map(({product,quantity}) => `<div class="cart-item"><div class="cart-item-img"><img src="${product.image}" alt="${product.title}" /></div><div class="cart-item-info"><h3>${product.title}</h3><small>${categoryName(product.category)}</small><div class="quantity-control"><button data-quantity="${product.id}" data-change="-1" aria-label="Decrease quantity">−</button><span>${quantity}</span><button data-quantity="${product.id}" data-change="1" aria-label="Increase quantity">+</button></div><button class="remove-item" data-remove="${product.id}">Remove</button></div><span class="cart-item-price">${money(product.price * quantity)}</span></div>`).join('');
  const subtotal = items.reduce((sum,item) => sum + item.product.price * item.quantity, 0);
  const delivery = subtotal >= 35 ? 0 : 5.99;
  const total = subtotal + delivery;
  $('#cart-footer').innerHTML = `<div class="summary-line"><span>Subtotal</span><strong>${money(subtotal)}</strong></div><div class="summary-line"><span>Delivery <small>${delivery ? 'Add $35 for free delivery' : 'Free delivery'}</small></span><strong>${delivery ? money(delivery) : 'FREE'}</strong></div><div class="summary-line total"><span>Total</span><strong>${money(total)}</strong></div><button class="button button-primary checkout-button" data-action="checkout">Go to checkout <span>→</span></button>`;
}

async function addToCart(id){state.cart[id] = (state.cart[id] || 0) + 1;saveCart();renderCart();if(state.session){try{await apiRequest('/cart/items',{method:'POST',body:JSON.stringify({productId:id,quantity:state.cart[id]})});}catch(error){showToast(error.message);return;}}showToast('Added to your cart');}
async function changeQuantity(id, change){state.cart[id] = (state.cart[id] || 0) + change;if(state.cart[id] <= 0) delete state.cart[id];saveCart();renderCart();if(state.session){try{await apiRequest(`/cart/items/${id}`,{method:'PATCH',body:JSON.stringify({quantity:state.cart[id] || 0})});}catch(error){showToast(error.message);}}}
function showToast(message){$('#toast-text').textContent = message;$('#toast').classList.add('show');clearTimeout(showToast.timeout);showToast.timeout = setTimeout(() => $('#toast').classList.remove('show'), 2400);}
function openCart(){$('#overlay').classList.add('visible');$('#cart-drawer').classList.add('open');document.body.style.overflow='hidden';}
function closeCart(){$('#overlay').classList.remove('visible');$('#cart-drawer').classList.remove('open');if(!$('#modal').classList.contains('open')) document.body.style.overflow='';}
function openModal(content){$('#modal-content').innerHTML = content;$('#overlay').classList.add('visible');$('#modal').classList.add('open');document.body.style.overflow='hidden';}
function closeModal(){$('#modal').classList.remove('open');if(!$('#cart-drawer').classList.contains('open')){ $('#overlay').classList.remove('visible');document.body.style.overflow=''; }}
function showProduct(product){openModal(`<div class="modal-product"><div class="modal-product-image"><img src="${product.image}" alt="${product.title}" /></div><div class="modal-product-copy"><span class="eyebrow">${product.tag}</span><span class="product-category">${categoryName(product.category)}</span><h2>${product.title}</h2><div class="rating"><span class="stars">★★★★★</span><small>${product.rating} (${product.reviews} reviews)</small></div><p>${product.description}</p><div class="product-price">${money(product.price)} ${product.oldPrice ? `<small><del>${money(product.oldPrice)}</del></small>` : ''}</div><button class="button button-primary" data-add-modal="${product.id}">Add to cart <span>→</span></button></div></div>`);}
function showInfo(title, body, actionLabel='Got it'){openModal(`<div class="modal-product-copy" style="padding:46px 42px 40px"><span class="eyebrow">MARKETLY</span><h2>${title}</h2><p>${body}</p><button class="button button-primary" data-action="close-modal">${actionLabel} <span>→</span></button></div>`);}
function showDepartments(){openModal(`<div class="modal-product-copy departments-modal"><span class="eyebrow">EXPLORE</span><h2>Shop by <em>department</em></h2><p>Find something useful, beautiful, or a little bit of both.</p><div class="modal-departments">${departments.map(dept => `<button class="outline-button" data-category="${dept.category}">${dept.name}<span>→</span></button>`).join('')}</div></div>`);}
function showAccount(){if(state.session){openModal(`<div class="modal-product-copy account-modal"><span class="eyebrow">YOUR ACCOUNT</span><h2>Welcome, ${state.session.user.firstName || state.session.user.email}.</h2><p>${state.session.user.email}</p><div class="account-actions"><button class="outline-button" data-action="orders">View your orders <span>→</span></button><button class="outline-button" data-action="sign-out">Sign out <span>→</span></button></div></div>`);return;}openModal(`<div class="modal-product-copy account-modal"><span class="eyebrow">WELCOME BACK</span><h2>Sign in to Marketly.</h2><form class="account-form" data-form="login"><label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" autocomplete="current-password" required /></label><button class="button button-primary" type="submit">Sign in <span>→</span></button></form><button class="text-button" data-action="show-register">Create an account <span>→</span></button></div>`);}
function showRegister(){openModal(`<div class="modal-product-copy account-modal"><span class="eyebrow">JOIN MARKETLY</span><h2>Create your account.</h2><form class="account-form" data-form="register"><label>First name<input name="firstName" autocomplete="given-name" required /></label><label>Last name<input name="lastName" autocomplete="family-name" /></label><label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" minlength="10" autocomplete="new-password" required /></label><button class="button button-primary" type="submit">Create account <span>→</span></button></form><button class="text-button" data-action="account">Already have an account? Sign in <span>→</span></button></div>`);}
function showCheckout(){if(!state.session){showAccount();return;}state.checkoutKey ||= crypto.randomUUID();openModal(`<div class="modal-product-copy checkout-modal"><span class="eyebrow">SECURE CHECKOUT</span><h2>Where should we deliver?</h2><form class="account-form" data-form="checkout"><label>Recipient<input name="recipient" value="${state.session.user.firstName || ''} ${state.session.user.lastName || ''}" required /></label><label>Address<input name="line1" autocomplete="street-address" required /></label><div class="checkout-fields"><label>City<input name="city" required /></label><label>Postal code<input name="postalCode" required /></label></div><label>Country<input name="country" value="US" required /></label><label>Payment method<input name="paymentMethod" value="test_card" required /></label><button class="button button-primary" type="submit">Place order <span>→</span></button></form></div>`);}
async function showOrders(){if(!state.session){showAccount();return;}try{const payload = await apiRequest('/orders?pageSize=20');const orders = payload.data || [];openModal(`<div class="modal-product-copy account-modal"><span class="eyebrow">YOUR ORDERS</span><h2>${orders.length ? 'Order history' : 'No orders yet.'}</h2>${orders.length ? `<div class="orders-list">${orders.map(order => `<div class="order-row"><strong>${order.orderNumber}</strong><span>${order.status}</span><b>${money(order.total)}</b></div>`).join('')}</div>` : '<p>Your completed orders will appear here.</p>'}</div>`);}catch(error){showInfo('Orders unavailable',error.message);}}
async function submitAccount(form){const data = Object.fromEntries(new FormData(form));const guestCart = {...state.cart};try{const payload = await apiRequest(`/auth/${form.dataset.form === 'register' ? 'register' : 'login'}`,{method:'POST',body:JSON.stringify(data)});setSession(payload);await syncCartFromServer(guestCart);closeModal();showToast('You are signed in');}catch(error){showToast(error.message);}}
async function submitCheckout(form){const data = Object.fromEntries(new FormData(form));try{const order = await apiRequest('/orders',{method:'POST',headers:{'idempotency-key':`checkout-${state.checkoutKey}`},body:JSON.stringify({shippingAddress:{recipient:data.recipient,line1:data.line1,city:data.city,postalCode:data.postalCode,country:data.country}})});const intent = await apiRequest('/payments/intents',{method:'POST',body:JSON.stringify({orderId:order.data.id})});const payment = await apiRequest(`/payments/intents/${intent.data.id}/confirm`,{method:'POST',body:JSON.stringify({paymentMethod:data.paymentMethod})});state.cart={};state.checkoutKey=null;saveCart();renderCart();openModal(`<div class="modal-product-copy account-modal"><span class="eyebrow">ORDER CONFIRMED</span><h2>Thank you for your order.</h2><p>Payment ${payment.data.status}. Your order number is <strong>${order.data.orderNumber}</strong>.</p><button class="button button-primary" data-action="close-modal">Continue shopping <span>→</span></button></div>`);}catch(error){showToast(error.message);}}

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if(action === 'cart') openCart();
  if(action === 'menu') showDepartments();
  if(action === 'close-cart') closeCart();
  if(action === 'close-modal') closeModal();
  if(action === 'continue-shopping') closeCart();
  if(action === 'clear-filters'){state.departments=[];state.rating=0;state.price='all';state.category='all';state.searchCategory='all';$('#search-category').value='all';$$('[data-filter-check]').forEach(input => input.checked=false);$$('[data-rating-check]').forEach(input => input.checked=false);$('input[name="price"][value="all"]').checked=true;renderProducts();}
  if(action === 'load-more'){state.visible += 4;renderProducts();}
  if(action === 'view-deals'){showToast('You are seeing all the best deals');document.querySelector('#deals').scrollIntoView({behavior:'smooth'});}
  if(action === 'all-departments') showDepartments();
  if(action === 'membership'){showInfo('Marketly+ is on us.', 'Join the waitlist and we will let you know the moment member perks are available in your area.', 'Join waitlist');}
  if(action === 'how-it-works'){showInfo('Shopping, made human.', 'We find useful, beautiful things from independent makers and trusted brands, then bring them to your door with simple delivery and easy returns.');}
  if(action === 'location'){showInfo('Where should we deliver?', 'Delivery estimates and availability are currently set to New York, 10001. Location switching will be available at checkout.');}
  if(action === 'account') showAccount();
  if(action === 'show-register') showRegister();
  if(action === 'sign-out'){clearSession();closeModal();showToast('You are signed out');}
  if(action === 'orders') showOrders();
  if(action === 'checkout') showCheckout();
  const add = event.target.closest('[data-add]')?.dataset.add;
  if(add) addToCart(add);
  const addModal = event.target.closest('[data-add-modal]')?.dataset.addModal;
  if(addModal){addToCart(addModal);closeModal();}
  const remove = event.target.closest('[data-remove]')?.dataset.remove;
  if(remove){delete state.cart[remove];saveCart();renderCart();}
  const quantity = event.target.closest('[data-quantity]');
  if(quantity) changeQuantity(quantity.dataset.quantity, Number(quantity.dataset.change));
  const wish = event.target.closest('[data-wishlist]')?.dataset.wishlist;
  if(wish){event.stopPropagation();state.wishlists = state.wishlists.includes(wish) ? state.wishlists.filter(id => id !== wish) : [...state.wishlists,wish];saveWishlist();renderProducts();showToast(state.wishlists.includes(wish) ? 'Saved to your wishlist' : 'Removed from wishlist');}
  const category = event.target.closest('[data-category]')?.dataset.category;
  if(category){state.category=category;state.searchCategory='all';state.departments=[];$('#search-category').value='all';state.visible=8;closeModal();document.querySelector('#recommended').scrollIntoView({behavior:'smooth'});renderProducts();}
  const card = event.target.closest('[data-product-id]');
  if(card && !event.target.closest('button')){const product=products.find(item => item.id === card.dataset.productId);if(product) showProduct(product);}
});

document.addEventListener('submit', event => {const form = event.target.closest('[data-form]');if(!form) return;event.preventDefault();if(form.dataset.form === 'checkout') submitCheckout(form);else submitAccount(form);});

$('#search-form').addEventListener('submit', event => {event.preventDefault();state.search=$('#search-input').value.trim();state.searchCategory=$('#search-category').value;state.category='all';state.departments=[];$$('[data-filter-check]').forEach(input => input.checked=false);state.visible=8;renderProducts();document.querySelector('#recommended').scrollIntoView({behavior:'smooth'});});
$('#search-input').addEventListener('input', event => {state.search=event.target.value.trim();renderProducts();});
$('#search-category').addEventListener('change', event => {state.searchCategory=event.target.value;state.category='all';state.departments=[];$$('[data-filter-check]').forEach(input => input.checked=false);state.visible=8;renderProducts();});
$$('.filter-tab').forEach(tab => tab.addEventListener('click', () => {$$('.filter-tab').forEach(item => item.classList.remove('active'));tab.classList.add('active');state.tab=tab.dataset.filter;state.visible=8;renderProducts();}));
$$('[data-filter-check]').forEach(input => input.addEventListener('change', () => {state.departments=$$('[data-filter-check]:checked').map(item => item.value);state.category='all';renderProducts();}));
$$('[data-rating-check]').forEach(input => input.addEventListener('change', () => {state.rating=Math.max(...$$('[data-rating-check]:checked').map(item => Number(item.value)),0);renderProducts();}));
$$('input[name="price"]').forEach(input => input.addEventListener('change', () => {state.price=input.value;renderProducts();}));
$('#sort-products').addEventListener('change', event => {state.sort=event.target.value;renderProducts();});
$('#newsletter-form').addEventListener('submit', event => {event.preventDefault();event.target.reset();showToast('You are on the list ✦');});
$('#overlay').addEventListener('click', () => {closeCart();closeModal();});
document.addEventListener('keydown', event => {if(event.key === 'Escape'){closeCart();closeModal();}});
$('#tenant-select').addEventListener('change', event => platform.set('tenant', event.target.value));
$('#universe-select').addEventListener('change', event => platform.set('universe', event.target.value));
$('#language-select').addEventListener('change', event => platform.set('locale', event.target.value));
$('#currency-select').addEventListener('change', event => platform.set('currency', event.target.value));
platform.subscribe(() => {renderContextControls();applyContext();renderProducts();renderCart();loadCatalog();syncCartFromServer();});

let dealSeconds = 8 * 60 * 60 + 42 * 60 + 16;
setInterval(() => {dealSeconds = Math.max(0,dealSeconds-1);const hours=String(Math.floor(dealSeconds/3600)).padStart(2,'0');const mins=String(Math.floor((dealSeconds%3600)/60)).padStart(2,'0');const secs=String(dealSeconds%60).padStart(2,'0');$('#deal-timer').textContent=`${hours}:${mins}:${secs}`;},1000);
renderContextControls();applyContext();renderDeals();renderDepartments();renderProducts();renderCart();loadExperience();loadCatalog();syncCartFromServer();
