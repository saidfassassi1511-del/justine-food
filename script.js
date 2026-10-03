document.addEventListener('DOMContentLoaded', () => {
    let cart = [];
    // Adresse du serveur dashboard (en ligne : remplacez par l'URL de votre serveur, ex: https://dashboard.votresite.com)
    const API_URL = '';
    const RESTAURANT_PHONE = '+229 01 66 86 35 53';

    // Envoie les données au dashboard (lève une erreur si l'envoi échoue)
    const postToDashboard = async (path, payload) => {
        const res = await fetch(API_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            let msg = 'Erreur serveur';
            try { msg = (await res.json()).error || msg; } catch (e) {}
            throw new Error(msg);
        }
        return res.json();
    };

    // Éléments Panier DOM
    const cartOpenBtn = document.getElementById('cartOpenBtn');
    const cartCloseBtn = document.getElementById('cartCloseBtn');
    const cartDrawer = document.getElementById('cartDrawer');
    const cartOverlay = document.getElementById('cartOverlay');
    const cartCount = document.getElementById('cartCount');
    const cartDrawerItems = document.getElementById('cartDrawerItems');
    const drawerTotal = document.getElementById('drawerTotal');
    const btnSendWhatsapp = document.getElementById('btnSendWhatsapp');
    const toast = document.getElementById('toast');

    // Éléments Menu Déroulant Mobile DOM
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileNavDrawer = document.getElementById('mobileNavDrawer');
    const mobileNavOverlay = document.getElementById('mobileNavOverlay');
    const closeMobileNav = document.getElementById('closeMobileNav');
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

    // Gestion de la Navigation Mobile
    const toggleMobileNav = (open) => {
        if (mobileNavDrawer) mobileNavDrawer.classList.toggle('active', open);
        if (mobileNavOverlay) mobileNavOverlay.classList.toggle('active', open);
    };

    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', () => toggleMobileNav(true));
    if (closeMobileNav) closeMobileNav.addEventListener('click', () => toggleMobileNav(false));
    if (mobileNavOverlay) mobileNavOverlay.addEventListener('click', () => toggleMobileNav(false));

    mobileNavLinks.forEach(link => {
        link.addEventListener('click', () => toggleMobileNav(false));
    });

    // Drawer Panier
    const toggleCartDrawer = (open) => {
        if (cartDrawer) cartDrawer.classList.toggle('active', open);
        if (cartOverlay) cartOverlay.classList.toggle('active', open);
    };

    if (cartOpenBtn) cartOpenBtn.addEventListener('click', () => toggleCartDrawer(true));
    if (cartCloseBtn) cartCloseBtn.addEventListener('click', () => toggleCartDrawer(false));
    if (cartOverlay) cartOverlay.addEventListener('click', () => toggleCartDrawer(false));

    // Toast Notification
    const showToast = (msg) => {
        if (!toast) return;
        toast.innerText = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    };

    // Fenêtre de confirmation (commande / réservation)
    const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const showConfirmModal = ({ title, message, ref, lines = [], total, trackUrl }) => {
        const old = document.getElementById('confirmModal');
        if (old) old.remove();
        const el = document.createElement('div');
        el.id = 'confirmModal';
        el.className = 'confirm-overlay';
        el.innerHTML = `
            <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
                <div class="confirm-check">✓</div>
                <h3 id="confirmTitle">${esc(title)}</h3>
                <p class="confirm-msg">${esc(message)}</p>
                ${ref ? `<div class="confirm-ref">N° ${esc(ref)}</div>` : ''}
                <ul class="confirm-lines">${lines.map(l => `<li><span>${esc(l[0])}</span><strong>${esc(l[1])}</strong></li>`).join('')}</ul>
                ${total ? `<div class="confirm-total"><span>Total à payer</span><strong>${esc(total)}</strong></div>` : ''}
                <div class="confirm-actions">
                    ${trackUrl ? `<a class="btn btn-primary" href="${trackUrl}" target="_blank" rel="noopener">Suivre ma commande</a>` : ''}
                    <button type="button" class="btn btn-secondary" id="confirmClose">Fermer</button>
                </div>
            </div>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        const close = () => el.remove();
        el.querySelector('#confirmClose').addEventListener('click', close);
        el.addEventListener('click', (e) => { if (e.target === el) close(); });
    };

    // Gestion Quantités
    window.incrementQty = (id) => {
        const input = document.getElementById(id);
        if (input) input.value = parseInt(input.value) + 1;
    };

    window.decrementQty = (id) => {
        const input = document.getElementById(id);
        if (input && parseInt(input.value) > 1) input.value = parseInt(input.value) - 1;
    };

    // Ajouter au Panier
    window.addToCart = (id, name, price, qtyId) => {
        const qtyInput = document.getElementById(qtyId);
        const qty = qtyInput ? parseInt(qtyInput.value) : 1;
        const index = cart.findIndex(item => item.id === id);

        if (index > -1) {
            cart[index].quantity += qty;
        } else {
            cart.push({ id, name, price, quantity: qty });
        }

        updateCart();
        showToast(`${qty}x ${name} ajouté au panier`);
    };

    // Mettre à jour Panier
    function updateCart() {
        if (!cartDrawerItems) return;
        cartDrawerItems.innerHTML = '';
        let total = 0;
        let count = 0;

        if (cart.length === 0) {
            cartDrawerItems.innerHTML = '<p class="empty-cart-text">Votre panier est vide.</p>';
            if (btnSendWhatsapp) btnSendWhatsapp.disabled = true;
        } else {
            if (btnSendWhatsapp) btnSendWhatsapp.disabled = false;
            cart.forEach((item, idx) => {
                total += item.price * item.quantity;
                count += item.quantity;

                const div = document.createElement('div');
                div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem; padding-bottom:0.6rem; border-bottom:1px dashed #e9ecef;';
                div.innerHTML = `
                    <div>
                        <strong style="font-size:0.88rem; display:block; color:var(--dark);">${item.name}</strong>
                        <span style="font-size:0.8rem; color:var(--primary); font-weight:700;">${item.quantity} x ${item.price.toLocaleString('fr-FR')} FCFA</span>
                    </div>
                    <button type="button" style="border:none; background:none; color:var(--primary); cursor:pointer; font-weight:bold; font-size:1.1rem; padding:4px;" onclick="removeFromCart(${idx})">✕</button>
                `;
                cartDrawerItems.appendChild(div);
            });
        }

        if (cartCount) cartCount.innerText = count;
        if (drawerTotal) drawerTotal.innerText = `${total.toLocaleString('fr-FR')} FCFA`;
    }

    window.removeFromCart = (idx) => {
        cart.splice(idx, 1);
        updateCart();
    };

    // Filtres de la Carte
    const filterContainer = document.getElementById('filterContainer');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-btn')) return;

            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            const selectedCategory = e.target.getAttribute('data-category');
            const cards = document.querySelectorAll('.food-card');

            cards.forEach(card => {
                const cardCat = card.getAttribute('data-category');
                if (selectedCategory === 'all' || cardCat === selectedCategory) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }

    // --- ENVOI DE LA COMMANDE AU DASHBOARD ---
    if (btnSendWhatsapp) {
        btnSendWhatsapp.addEventListener('click', async () => {
            if (cart.length === 0) return;

            const name = document.getElementById('custName').value.trim();
            const address = document.getElementById('custAddress').value.trim();
            const phone = document.getElementById('custPhone').value.trim();
            const paymentMethod = document.getElementById('custPayment').value;

            if (!name || !address || !phone) {
                alert("Veuillez remplir votre Nom, votre Téléphone et votre Adresse de livraison.");
                return;
            }
            if (phone.replace(/\D/g, '').length < 8) {
                alert("Veuillez saisir un numéro de téléphone valide.");
                return;
            }

            const originalLabel = btnSendWhatsapp.innerHTML;
            btnSendWhatsapp.disabled = true;
            btnSendWhatsapp.textContent = 'Envoi en cours…';

            const snapshot = cart.map(i => ({ name: i.name, qty: i.quantity, price: i.price }));
            const orderTotal = snapshot.reduce((sum, i) => sum + i.qty * i.price, 0);

            try {
                const result = await postToDashboard('/api/orders', {
                    name, phone, address, payment: paymentMethod,
                    items: cart.map(i => ({ name: i.name, qty: i.quantity, price: i.price }))
                });
                cart = [];
                toggleCartDrawer(false);
                document.getElementById('custName').value = '';
                document.getElementById('custAddress').value = '';
                document.getElementById('custPhone').value = '';
                showConfirmModal({
                    title: 'Commande reçue',
                    message: `Merci ${name} ! Votre commande est en cours de traitement. Nous vous contactons au ${phone} si besoin.`,
                    ref: result.id.toUpperCase(),
                    lines: [
                        ...snapshot.map(i => [`${i.qty} × ${i.name}`, `${(i.qty * i.price).toLocaleString('fr-FR')} FCFA`]),
                        ['Livraison', address],
                        ['Paiement', paymentMethod]
                    ],
                    total: `${orderTotal.toLocaleString('fr-FR')} FCFA`,
                    trackUrl: `${API_URL}/suivi?id=${encodeURIComponent(result.id)}`
                });
            } catch (err) {
                alert(`Impossible d'envoyer votre commande pour le moment. Vérifiez votre connexion et réessayez, ou appelez-nous au ${RESTAURANT_PHONE}.`);
            } finally {
                btnSendWhatsapp.innerHTML = originalLabel;
                updateCart();
            }
        });
    }

    // --- ENVOI DE LA RÉSERVATION AU DASHBOARD ---
    const reservationForm = document.getElementById('reservationForm');
    if (reservationForm) {
        reservationForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const resName = document.getElementById('resName').value.trim();
            const resPhone = document.getElementById('resPhone').value.trim();
            const resGuests = document.getElementById('resGuests').value;
            const rawDate = document.getElementById('resDate').value;
            const resNotes = document.getElementById('resNotes').value.trim();

            if (!resName || !resPhone || !rawDate) {
                alert("Veuillez remplir tous les champs obligatoires pour la réservation.");
                return;
            }

            const submitBtn = reservationForm.querySelector('button[type="submit"]');
            const originalLabel = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Envoi en cours…';

            try {
                const result = await postToDashboard('/api/reservations', {
                    name: resName, phone: resPhone, guests: resGuests, datetime: rawDate, note: resNotes
                });
                reservationForm.reset();
                showConfirmModal({
                    title: 'Réservation reçue',
                    message: `Merci ${resName} ! Votre demande est en attente de confirmation. Nous vous contactons très vite au ${resPhone}.`,
                    ref: result.id.toUpperCase(),
                    lines: [
                        ['Date & heure', new Date(rawDate).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })],
                        ['Personnes', resGuests]
                    ].concat(resNotes ? [['Demande', resNotes]] : [])
                });
            } catch (err) {
                alert(`Impossible d'envoyer votre réservation pour le moment. Vérifiez votre connexion et réessayez, ou appelez-nous au ${RESTAURANT_PHONE}.`);
            } finally {
                submitBtn.innerHTML = originalLabel;
                submitBtn.disabled = false;
            }
        });
    }
});