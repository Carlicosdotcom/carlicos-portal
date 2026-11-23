/**
 * app.js - Carlicos Player · Portal Remoto & Panel Maestro
 * PWA estática sin build step conectada a Supabase RPC.
 */

(function () {
    'use strict';

    var SUPABASE_URL = 'https://hvkjzgjaibhadxxtvmte.supabase.co';
    var SUPABASE_KEY = 'sb_publishable_Jqt6dL9ugHPYJ3FjfFZv9g_T20wo4zZ';

    // Estado en memoria
    var state = {
        activeTab: 'ibo', // 'ibo' | 'master'
        iboDevice: null,  // { mac, key, alias, platform, app_version, is_active, last_seen, playlists: [] }
        masterPassword: sessionStorage.getItem('carlicos_master_session') || '',
        masterDevices: [],
        activeMasterDevice: null, // TV cuyas listas se están gestionando
        playlistModalContext: null, // { mode: 'ibo' | 'master', item: null }
        masterFilters: {
            search: '',
            status: 'all',
            platform: 'all',
            sort: 'last_seen'
        },
        copyingPlaylist: null
    };

    // ============================================================
    // 1. CLIENTE SUPABASE RPC
    // ============================================================
    async function callRpc(fnName, payload) {
        var url = SUPABASE_URL + '/rest/v1/rpc/' + fnName;
        var headers = {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY
        };
        if (SUPABASE_KEY.startsWith('eyJ')) {
            headers['Authorization'] = 'Bearer ' + SUPABASE_KEY;
        }

        try {
            var res = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload || {})
            });

            var text = await res.text();
            var data = null;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error('Respuesta no válida del servidor');
            }

            if (!res.ok) {
                var errDetail = data && (data.message || data.error || data.details) ? (data.message || data.error) : ('HTTP ' + res.status);
                throw new Error(errDetail);
            }

            return data;
        } catch (err) {
            throw err;
        }
    }

    // ============================================================
    // 2. TOASTS Y UTILIDADES
    // ============================================================
    function showToast(message, type) {
        var container = document.getElementById('toastContainer');
        if (!container) return;

        var toast = document.createElement('div');
        toast.className = 'toast ' + (type === 'success' ? 'toast-success' : (type === 'error' ? 'toast-error' : ''));
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(function () {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    function formatMacInput(value) {
        var clean = value.toUpperCase().replace(/[^0-9A-F]/g, '');
        var parts = [];
        for (var i = 0; i < clean.length && i < 12; i += 2) {
            parts.push(clean.substring(i, i + 2));
        }
        return parts.join(':');
    }

    function formatDate(isoStr) {
        if (!isoStr) return 'Nunca';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return isoStr;
            var pad = function (n) { return n < 10 ? '0' + n : n; };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
                   pad(d.getHours()) + ':' + pad(d.getMinutes());
        } catch (e) {
            return isoStr;
        }
    }

    function maskServerUrl(url) {
        if (!url) return '';
        try {
            var match = url.match(/^(https?:\/\/[^\/:]+)(?::(\d+))?/i);
            if (match) {
                return match[1] + (match[2] ? ':' + match[2] : '');
            }
        } catch (e) {}
        return url;
    }

    // ============================================================
    // 3. PESTAÑAS
    // ============================================================
    function setTab(tab) {
        state.activeTab = tab;
        var btnIbo = document.getElementById('tabBtnIbo');
        var btnMaster = document.getElementById('tabBtnMaster');
        var paneIbo = document.getElementById('paneIbo');
        var paneMaster = document.getElementById('paneMaster');

        if (tab === 'ibo') {
            closePlaylistModal();
            closeEditDeviceModal();
            closeMasterDeviceDetail();
            closeBulkServerModal();
            closeCopyPlaylistModal();
            btnIbo.className = 'tab-btn active';
            btnMaster.className = 'tab-btn';
            paneIbo.className = 'tab-pane active';
            paneMaster.className = 'tab-pane';
        } else {
            btnIbo.className = 'tab-btn';
            btnMaster.className = 'tab-btn active';
            paneIbo.className = 'tab-pane';
            paneMaster.className = 'tab-pane active';

            if (state.masterPassword) {
                loadMasterDevices();
            }
        }
    }

    // ============================================================
    // 4. MODO IBO (DISPOSITIVO)
    // ============================================================
    async function handleIboLogin(e) {
        if (e && e.preventDefault) e.preventDefault();
        var macInput = document.getElementById('iboInputMac');
        var keyInput = document.getElementById('iboInputKey');
        var btnLogin = document.getElementById('btnIboLogin');

        var mac = (macInput ? macInput.value.trim().toUpperCase() : '');
        var key = (keyInput ? keyInput.value.trim() : '');

        if (!mac || !key) {
            showToast('Introduce la MAC y el Device Key', 'error');
            return;
        }

        if (btnLogin) {
            btnLogin.disabled = true;
            btnLogin.textContent = 'Conectando con TV...';
        }

        try {
            var data = await callRpc('ibo_get_device', { p_mac: mac, p_key: key });
            if (data && data.ok && data.device) {
                state.iboDevice = {
                    mac: data.device.mac,
                    key: key,
                    alias: data.device.alias || '',
                    platform: data.device.platform || '',
                    app_version: data.device.app_version || '',
                    is_active: data.device.is_active,
                    last_seen: data.device.last_seen,
                    playlists: data.playlists || []
                };

                renderIboDashboard();
                showToast('Televisor conectado con éxito', 'success');
            } else {
                showToast('Dispositivo no encontrado o clave incorrecta', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.textContent = 'Entrar a mi Televisor';
            }
        }
    }

    function renderIboDashboard() {
        var loginForm = document.getElementById('iboLoginForm');
        var dashboard = document.getElementById('iboDashboard');
        if (!state.iboDevice) {
            if (loginForm) loginForm.style.display = 'block';
            if (dashboard) dashboard.className = 'hidden';
            return;
        }

        if (loginForm) loginForm.style.display = 'none';
        if (dashboard) dashboard.className = '';

        var titleEl = document.getElementById('iboDeviceTitle');
        var badgeEl = document.getElementById('iboStatusBadge');
        var macEl = document.getElementById('iboDisplayMac');
        var platEl = document.getElementById('iboDisplayPlatform');
        var lastEl = document.getElementById('iboDisplayLastSeen');

        if (titleEl) titleEl.textContent = state.iboDevice.alias ? ('TV: ' + state.iboDevice.alias) : 'Mi Televisor';
        if (badgeEl) {
            if (state.iboDevice.is_active) {
                badgeEl.className = 'status-badge active';
                badgeEl.textContent = 'ACTIVA';
            } else {
                badgeEl.className = 'status-badge paused';
                badgeEl.textContent = 'PAUSADA';
            }
        }
        if (macEl) macEl.textContent = state.iboDevice.mac;
        if (platEl) platEl.textContent = (state.iboDevice.platform || 'samsung-tizen') + ' (v' + (state.iboDevice.app_version || '3.5.0') + ')';
        if (lastEl) lastEl.textContent = formatDate(state.iboDevice.last_seen);

        renderIboPlaylists();
    }

    function renderIboPlaylists() {
        var container = document.getElementById('iboPlaylistsList');
        if (!container) return;
        container.innerHTML = '';

        var playlists = (state.iboDevice && state.iboDevice.playlists) ? state.iboDevice.playlists : [];
        if (playlists.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay listas Xtream asignadas a este televisor. Pulsa "+ Añadir Lista Xtream" para vincular una.</div>';
            return;
        }

        playlists.forEach(function (pl) {
            var card = document.createElement('div');
            card.className = 'playlist-card' + (pl.is_default ? ' is-default' : '');

            var topRow = document.createElement('div');
            topRow.className = 'playlist-card-top';

            var nameEl = document.createElement('span');
            nameEl.className = 'playlist-name';
            nameEl.textContent = pl.name || 'Lista sin nombre';
            topRow.appendChild(nameEl);

            if (pl.is_default) {
                var defBadge = document.createElement('span');
                defBadge.className = 'playlist-badge-default';
                defBadge.textContent = 'PRINCIPAL';
                topRow.appendChild(defBadge);
            }
            card.appendChild(topRow);

            var details = document.createElement('div');
            details.className = 'playlist-details';
            var srvEl = document.createElement('span');
            srvEl.className = 'playlist-server';
            srvEl.textContent = 'Servidor: ' + maskServerUrl(pl.server);
            var usrEl = document.createElement('span');
            usrEl.textContent = 'Usuario: ' + (pl.username || '--');
            details.appendChild(srvEl);
            details.appendChild(usrEl);

            var passRow = document.createElement('div');
            passRow.className = 'playlist-pass-row';
            var passLabel = document.createElement('span');
            passLabel.textContent = 'Contraseña: ';
            var passVal = document.createElement('span');
            passVal.className = 'playlist-pass-val';
            var rawPass = pl.password || pl.pass || '';
            var isRevealed = false;
            passVal.textContent = rawPass ? '••••••••' : '--';

            passRow.appendChild(passLabel);
            passRow.appendChild(passVal);
            if (rawPass) {
                var btnEye = document.createElement('button');
                btnEye.type = 'button';
                btnEye.className = 'btn-toggle-eye-mini';
                btnEye.setAttribute('aria-label', 'Mostrar u ocultar contraseña');
                btnEye.textContent = '👁️';
                btnEye.onclick = function () {
                    isRevealed = !isRevealed;
                    passVal.textContent = isRevealed ? rawPass : '••••••••';
                };
                passRow.appendChild(btnEye);
            }
            details.appendChild(passRow);
            card.appendChild(details);

            var actions = document.createElement('div');
            actions.className = 'playlist-actions';

            if (!pl.is_default) {
                var btnMakeDefault = document.createElement('button');
                btnMakeDefault.className = 'btn btn-secondary';
                btnMakeDefault.textContent = 'Marcar Principal';
                btnMakeDefault.onclick = function () {
                    iboMakePlaylistDefault(pl);
                };
                actions.appendChild(btnMakeDefault);
            }

            var btnEdit = document.createElement('button');
            btnEdit.className = 'btn btn-secondary';
            btnEdit.textContent = 'Editar';
            btnEdit.onclick = function () {
                openPlaylistModal('ibo', pl);
            };
            actions.appendChild(btnEdit);

            var btnDel = document.createElement('button');
            btnDel.className = 'btn btn-danger';
            btnDel.textContent = 'Eliminar';
            btnDel.onclick = function () {
                iboDeletePlaylist(pl);
            };
            actions.appendChild(btnDel);

            card.appendChild(actions);
            container.appendChild(card);
        });
    }

    async function iboMakePlaylistDefault(pl) {
        if (!state.iboDevice) return;
        try {
            var payload = {
                p_id: pl.id,
                p_mac: state.iboDevice.mac,
                p_key: state.iboDevice.key,
                p_name: pl.name,
                p_server: pl.server,
                p_user: pl.username,
                p_pass: pl.password,
                p_is_default: true
            };
            var res = await callRpc('ibo_upsert_playlist', payload);
            if (res && res.ok) {
                showToast('Lista principal actualizada', 'success');
                await refreshIboDevice();
            } else {
                showToast('No se pudo actualizar la lista', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    }

    async function iboDeletePlaylist(pl) {
        if (!state.iboDevice) return;
        if (!confirm('¿Eliminar la lista "' + pl.name + '" de este televisor?')) return;

        try {
            var payload = {
                p_id: pl.id,
                p_mac: state.iboDevice.mac,
                p_key: state.iboDevice.key
            };
            var res = await callRpc('ibo_delete_playlist', payload);
            if (res && res.ok) {
                showToast('Lista eliminada con éxito', 'success');
                await refreshIboDevice();
            } else {
                showToast('No se pudo eliminar la lista', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    }

    async function refreshIboDevice() {
        if (!state.iboDevice) return;
        try {
            var data = await callRpc('ibo_get_device', { p_mac: state.iboDevice.mac, p_key: state.iboDevice.key });
            if (data && data.ok && data.device) {
                state.iboDevice.alias = data.device.alias || '';
                state.iboDevice.is_active = data.device.is_active;
                state.iboDevice.last_seen = data.device.last_seen;
                state.iboDevice.playlists = data.playlists || [];
                renderIboDashboard();
            }
        } catch (e) {}
    }

    function handleIboLogout() {
        state.iboDevice = null;
        var macInput = document.getElementById('iboInputMac');
        var keyInput = document.getElementById('iboInputKey');
        if (macInput) macInput.value = '';
        if (keyInput) keyInput.value = '';
        renderIboDashboard();
        showToast('Sesión de dispositivo cerrada', 'info');
    }

    // ============================================================
    // 5. PANEL MAESTRO PRIVADO
    // ============================================================
    async function handleMasterLogin(e) {
        if (e && e.preventDefault) e.preventDefault();
        var passInput = document.getElementById('masterInputPass');
        var btnLogin = document.getElementById('btnMasterLogin');

        var pwd = (passInput ? passInput.value.trim() : '');
        if (!pwd) {
            showToast('Introduce la contraseña maestra', 'error');
            return;
        }

        if (btnLogin) {
            btnLogin.disabled = true;
            btnLogin.textContent = 'Verificando con servidor...';
        }

        try {
            var data = await callRpc('master_list_devices', { p_password: pwd });
            if (data && data.ok && Array.isArray(data.devices)) {
                state.masterPassword = pwd;
                sessionStorage.setItem('carlicos_master_session', pwd);
                state.masterDevices = data.devices;
                renderMasterDashboard();
                showToast('Acceso maestro concedido', 'success');
            } else {
                showToast('Contraseña maestra incorrecta', 'error');
            }
        } catch (err) {
            showToast('Contraseña incorrecta o error de servidor', 'error');
        } finally {
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.textContent = 'Acceder al Panel';
            }
        }
    }

    async function loadMasterDevices() {
        if (!state.masterPassword) return;
        var refreshBtn = document.getElementById('btnMasterRefresh');
        if (refreshBtn) refreshBtn.disabled = true;

        try {
            var data = await callRpc('master_list_devices', { p_password: state.masterPassword });
            if (data && data.ok && Array.isArray(data.devices)) {
                state.masterDevices = data.devices;
                renderMasterDashboard();
                showToast('Dispositivos actualizados', 'info');
            } else {
                showToast('Error al refrescar dispositivos', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    function getFilteredAndSortedMasterDevices() {
        var list = state.masterDevices.slice();
        var search = (state.masterFilters.search || '').toLowerCase().trim();
        var status = state.masterFilters.status || 'all';
        var platform = state.masterFilters.platform || 'all';
        var sort = state.masterFilters.sort || 'last_seen';

        // 1. Filtro de búsqueda en tiempo real
        if (search) {
            list = list.filter(function (dev) {
                var aliasMatch = dev.alias && dev.alias.toLowerCase().indexOf(search) !== -1;
                var macMatch = dev.mac && dev.mac.toLowerCase().indexOf(search) !== -1;
                var keyVal = (dev.key || dev.device_key || '').toLowerCase();
                var keyMatch = keyVal.indexOf(search) !== -1;
                var plMatch = false;
                if (dev.playlists && Array.isArray(dev.playlists)) {
                    for (var i = 0; i < dev.playlists.length; i++) {
                        var p = dev.playlists[i];
                        if (p.name && p.name.toLowerCase().indexOf(search) !== -1) {
                            plMatch = true;
                            break;
                        }
                        if (p.server && p.server.toLowerCase().indexOf(search) !== -1) {
                            plMatch = true;
                            break;
                        }
                    }
                }
                return aliasMatch || macMatch || keyMatch || plMatch;
            });
        }

        // 2. Filtro de Estado
        if (status === 'active') {
            list = list.filter(function (dev) { return dev.is_active === true; });
        } else if (status === 'paused') {
            list = list.filter(function (dev) { return dev.is_active === false; });
        }

        // 3. Filtro de Plataforma
        if (platform !== 'all') {
            list = list.filter(function (dev) {
                var p = (dev.platform || '').toLowerCase();
                if (platform === 'samsung-tizen') return p.indexOf('tizen') !== -1;
                if (platform === 'lg-webos') return p.indexOf('webos') !== -1;
                if (platform === 'android') return p.indexOf('android') !== -1;
                return p === platform;
            });
        }

        // 4. Ordenación
        if (sort === 'alias') {
            list.sort(function (a, b) {
                var nameA = (a.alias || 'zzz').toLowerCase();
                var nameB = (b.alias || 'zzz').toLowerCase();
                return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
            });
        } else if (sort === 'playlists') {
            list.sort(function (a, b) {
                var countA = (a.playlists_count !== undefined) ? a.playlists_count : ((a.playlists && a.playlists.length) || 0);
                var countB = (b.playlists_count !== undefined) ? b.playlists_count : ((b.playlists && b.playlists.length) || 0);
                return countB - countA;
            });
        } else {
            // 'last_seen' por defecto (más reciente primero)
            list.sort(function (a, b) {
                var timeA = a.last_seen ? new Date(a.last_seen).getTime() : 0;
                var timeB = b.last_seen ? new Date(b.last_seen).getTime() : 0;
                return timeB - timeA;
            });
        }

        return list;
    }

    function renderMasterDashboard() {
        var loginForm = document.getElementById('masterLoginForm');
        var dashboard = document.getElementById('masterDashboard');
        var listView = document.getElementById('masterDevicesListView');
        var detailView = document.getElementById('masterDeviceDetailView');

        if (!state.masterPassword) {
            if (loginForm) {
                loginForm.classList.remove('hidden');
                loginForm.style.display = '';
            }
            if (dashboard) dashboard.classList.add('hidden');
            return;
        }

        if (loginForm) {
            loginForm.classList.add('hidden');
            loginForm.style.display = 'none';
        }
        if (dashboard) dashboard.classList.remove('hidden');

        // Mantener o restaurar la sub-vista adecuada
        if (state.activeMasterDevice) {
            if (listView) listView.classList.add('hidden');
            if (detailView) detailView.classList.remove('hidden');
            renderMasterDeviceDetailSummary(state.activeMasterDevice);
        } else {
            if (listView) listView.classList.remove('hidden');
            if (detailView) detailView.classList.add('hidden');
        }

        var filtered = getFilteredAndSortedMasterDevices();

        var countEl = document.getElementById('masterDeviceCount');
        if (countEl) {
            if (filtered.length === state.masterDevices.length) {
                countEl.textContent = state.masterDevices.length;
            } else {
                countEl.textContent = filtered.length + ' de ' + state.masterDevices.length;
            }
        }

        var container = document.getElementById('masterDevicesList');
        if (!container) return;
        container.innerHTML = '';

        if (state.masterDevices.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay televisores registrados todavía.</div>';
            return;
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay televisores que coincidan con los filtros de búsqueda.</div>';
            return;
        }

        // Vista compacta en filas: 10-12 televisores de un vistazo
        filtered.forEach(function (dev) {
            var row = document.createElement('div');
            row.className = 'master-device-row';

            var main = document.createElement('div');
            main.className = 'master-row-main';

            var titleRow = document.createElement('div');
            titleRow.className = 'master-row-title-row';

            var aliasEl = document.createElement('span');
            aliasEl.className = 'master-row-alias' + (!dev.alias ? ' no-alias' : '');
            aliasEl.textContent = dev.alias || 'Sin alias configurado';
            titleRow.appendChild(aliasEl);

            var statusBadge = document.createElement('span');
            statusBadge.className = 'status-badge ' + (dev.is_active ? 'active' : 'paused');
            statusBadge.textContent = dev.is_active ? 'ACTIVA' : 'PAUSADA';
            titleRow.appendChild(statusBadge);

            var platName = 'Tizen';
            var platLow = (dev.platform || '').toLowerCase();
            if (platLow.indexOf('webos') !== -1) platName = 'webOS';
            else if (platLow.indexOf('android') !== -1) platName = 'Android';
            else if (platLow.indexOf('tizen') !== -1) platName = 'Tizen';
            else if (dev.platform) platName = dev.platform;

            var platBadge = document.createElement('span');
            platBadge.className = 'badge-platform';
            platBadge.textContent = platName;
            titleRow.appendChild(platBadge);

            var plCount = (dev.playlists_count !== undefined) ? dev.playlists_count : ((dev.playlists && dev.playlists.length) || 0);
            var plBadge = document.createElement('span');
            plBadge.className = 'badge-playlists';
            plBadge.textContent = plCount + (plCount === 1 ? ' lista' : ' listas');
            titleRow.appendChild(plBadge);

            main.appendChild(titleRow);

            var metaRow = document.createElement('div');
            metaRow.className = 'master-row-meta';
            metaRow.innerHTML = 
                '<span class="mono">' + dev.mac + '</span>' +
                '<span class="meta-sep">·</span>' +
                '<span>Key: <strong class="mono">' + (dev.key || dev.device_key || '------') + '</strong></span>' +
                '<span class="meta-sep">·</span>' +
                '<span>Conex.: ' + formatDate(dev.last_seen) + '</span>';
            main.appendChild(metaRow);

            row.appendChild(main);

            // Acciones compactas
            var actions = document.createElement('div');
            actions.className = 'master-row-actions';

            var btnManagePl = document.createElement('button');
            btnManagePl.className = 'btn btn-primary btn-sm';
            btnManagePl.textContent = 'Listas';
            btnManagePl.onclick = function () {
                openMasterDeviceDetail(dev);
            };
            actions.appendChild(btnManagePl);

            var btnEditDev = document.createElement('button');
            btnEditDev.className = 'btn btn-secondary btn-sm';
            btnEditDev.textContent = 'Editar';
            btnEditDev.onclick = function () {
                openEditDeviceModal(dev);
            };
            actions.appendChild(btnEditDev);

            var btnDelDev = document.createElement('button');
            btnDelDev.className = 'btn btn-danger btn-sm';
            btnDelDev.textContent = 'Eliminar';
            btnDelDev.onclick = function () {
                masterDeleteDevice(dev);
            };
            actions.appendChild(btnDelDev);

            row.appendChild(actions);
            container.appendChild(row);
        });
    }

    function handleMasterLogout() {
        state.masterPassword = '';
        sessionStorage.removeItem('carlicos_master_session');
        state.masterDevices = [];
        state.activeMasterDevice = null;
        closePlaylistModal();
        closeEditDeviceModal();
        closeBulkServerModal();
        closeCopyPlaylistModal();
        var listView = document.getElementById('masterDevicesListView');
        var detailView = document.getElementById('masterDeviceDetailView');
        if (listView) listView.classList.remove('hidden');
        if (detailView) detailView.classList.add('hidden');
        var passInput = document.getElementById('masterInputPass');
        if (passInput) passInput.value = '';
        renderMasterDashboard();
        showToast('Sesión maestra cerrada', 'info');
    }

    // Modal Editar TV
    function openEditDeviceModal(dev) {
        var modal = document.getElementById('modalEditDevice');
        var macHidden = document.getElementById('modalEditDeviceMac');
        var macDisplay = document.getElementById('modalEditDeviceMacDisplay');
        var aliasInput = document.getElementById('modalEditDeviceAlias');
        var keyInput = document.getElementById('modalEditDeviceKey');
        var activeCheck = document.getElementById('modalEditDeviceActive');

        if (macHidden) macHidden.value = dev.mac;
        if (macDisplay) macDisplay.value = dev.mac;
        if (aliasInput) aliasInput.value = dev.alias || '';
        if (keyInput) keyInput.value = '';
        if (activeCheck) activeCheck.checked = Boolean(dev.is_active);

        if (modal) modal.className = 'modal-overlay';
    }

    function closeEditDeviceModal() {
        var modal = document.getElementById('modalEditDevice');
        if (modal) modal.className = 'modal-overlay hidden';
    }

    async function handleSaveDevice(e) {
        if (e && e.preventDefault) e.preventDefault();
        var mac = document.getElementById('modalEditDeviceMac').value;
        var alias = document.getElementById('modalEditDeviceAlias').value.trim();
        var newKey = document.getElementById('modalEditDeviceKey').value.trim();
        var isActive = document.getElementById('modalEditDeviceActive').checked;
        var saveBtn = document.getElementById('btnSaveEditDeviceModal');

        if (newKey && !/^[0-9]{6}$/.test(newKey)) {
            showToast('El Device Key debe ser de 6 dígitos numéricos', 'error');
            return;
        }

        if (saveBtn) saveBtn.disabled = true;

        try {
            var payload = {
                p_password: state.masterPassword,
                p_mac: mac,
                p_alias: alias,
                p_is_active: isActive,
                p_new_key: newKey || null
            };
            var res = await callRpc('master_update_device', payload);
            if (res && res.ok) {
                showToast('Televisor actualizado con éxito', 'success');
                closeEditDeviceModal();
                await loadMasterDevices();
                if (state.activeMasterDevice && state.activeMasterDevice.mac === mac) {
                    for (var k = 0; k < state.masterDevices.length; k++) {
                        if (state.masterDevices[k].mac === mac) {
                            state.activeMasterDevice = state.masterDevices[k];
                            renderMasterDeviceDetailSummary(state.activeMasterDevice);
                            break;
                        }
                    }
                }
            } else {
                showToast('Error al actualizar televisor', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function masterDeleteDevice(dev) {
        var nombre = dev.alias || dev.mac;
        if (!confirm('¿Seguro que deseas eliminar definitivamente el televisor ' + nombre + '?\n\nSe borrarán todas sus listas asociadas.')) {
            return;
        }

        try {
            var payload = {
                p_password: state.masterPassword,
                p_mac: dev.mac
            };
            var res = await callRpc('master_delete_device', payload);
            if (res && res.ok) {
                showToast('Televisor eliminado', 'success');
                if (state.activeMasterDevice && state.activeMasterDevice.mac === dev.mac) {
                    closeMasterDeviceDetail();
                } else {
                    await loadMasterDevices();
                }
            } else {
                showToast('No se pudo eliminar el televisor', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    }

    // ============================================================
    // 5. SUB-VISTA DETALLE Y GESTIÓN DE LISTAS DE UN TELEVISOR
    // ============================================================
    function openMasterDeviceDetail(dev) {
        state.activeMasterDevice = dev;

        var macField = document.getElementById('modalPlaylistTargetMac');
        if (macField) macField.value = dev.mac;

        renderMasterDeviceDetailSummary(dev);

        var listView = document.getElementById('masterDevicesListView');
        var detailView = document.getElementById('masterDeviceDetailView');
        if (listView) listView.classList.add('hidden');
        if (detailView) detailView.classList.remove('hidden');

        window.scrollTo(0, 0);
        loadMasterDevicePlaylists();
    }

    function renderMasterDeviceDetailSummary(dev) {
        if (!dev) return;
        var aliasEl = document.getElementById('masterDetailTvAlias');
        var badgeEl = document.getElementById('masterDetailTvBadge');
        var macEl = document.getElementById('masterDetailTvMac');
        var keyEl = document.getElementById('masterDetailTvKey');
        var platEl = document.getElementById('masterDetailTvPlatform');
        var lastEl = document.getElementById('masterDetailTvLastSeen');
        var countEl = document.getElementById('masterDetailTvPlCount');
        var btnEditTv = document.getElementById('btnMasterDetailEditTv');

        if (aliasEl) {
            aliasEl.textContent = dev.alias || 'Sin alias configurado';
            aliasEl.className = 'master-device-alias' + (!dev.alias ? ' no-alias' : '');
        }
        if (badgeEl) {
            badgeEl.className = 'status-badge ' + (dev.is_active ? 'active' : 'paused');
            badgeEl.textContent = dev.is_active ? 'ACTIVA' : 'PAUSADA';
        }
        if (macEl) macEl.textContent = dev.mac;
        if (keyEl) keyEl.textContent = dev.key || dev.device_key || '------';
        if (platEl) platEl.textContent = (dev.platform || 'samsung-tizen') + ' v' + (dev.app_version || '3.5.0');
        if (lastEl) lastEl.textContent = formatDate(dev.last_seen);
        if (countEl) {
            var plCount = (dev.playlists_count !== undefined) ? dev.playlists_count : ((dev.playlists && dev.playlists.length) || 0);
            countEl.textContent = plCount;
        }
        if (btnEditTv) {
            btnEditTv.onclick = function () {
                openEditDeviceModal(dev);
            };
        }
    }

    function closeMasterDeviceDetail() {
        state.activeMasterDevice = null;
        var listView = document.getElementById('masterDevicesListView');
        var detailView = document.getElementById('masterDeviceDetailView');
        if (listView) listView.classList.remove('hidden');
        if (detailView) detailView.classList.add('hidden');
        loadMasterDevices();
    }

    async function loadMasterDevicePlaylists() {
        if (!state.activeMasterDevice) return;
        var container = document.getElementById('masterDevicePlaylistsContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">Cargando listas del televisor...</div>';

        try {
            var dev = state.activeMasterDevice;
            var devKey = dev.key || dev.device_key || '';
            var data = await callRpc('ibo_get_device', { p_mac: dev.mac, p_key: devKey });
            var playlists = (data && data.playlists) ? data.playlists : [];

            var countEl = document.getElementById('masterDetailTvPlCount');
            if (countEl) countEl.textContent = playlists.length;

            renderMasterPlaylistsList(playlists);
        } catch (err) {
            container.innerHTML = '<div class="empty-state" style="color:var(--accent-red);">Error al cargar listas: ' + err.message + '</div>';
        }
    }

    function renderMasterPlaylistsList(playlists) {
        var container = document.getElementById('masterDevicePlaylistsContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!playlists || playlists.length === 0) {
            container.innerHTML = '<div class="empty-state">Este televisor no tiene listas Xtream configuradas. Pulsa "+ Añadir Lista Xtream" arriba para asignar una.</div>';
            return;
        }

        playlists.forEach(function (pl) {
            var card = document.createElement('div');
            card.className = 'playlist-card' + (pl.is_default ? ' is-default' : '');

            var topRow = document.createElement('div');
            topRow.className = 'playlist-card-top';

            var nameEl = document.createElement('span');
            nameEl.className = 'playlist-name';
            nameEl.textContent = pl.name || 'Lista sin nombre';
            topRow.appendChild(nameEl);

            if (pl.is_default) {
                var defBadge = document.createElement('span');
                defBadge.className = 'playlist-badge-default';
                defBadge.textContent = 'PRINCIPAL';
                topRow.appendChild(defBadge);
            }
            card.appendChild(topRow);

            var details = document.createElement('div');
            details.className = 'playlist-details';
            var srvEl = document.createElement('span');
            srvEl.className = 'playlist-server';
            srvEl.textContent = 'Servidor: ' + maskServerUrl(pl.server);
            var usrEl = document.createElement('span');
            usrEl.textContent = 'Usuario: ' + (pl.username || '--');
            details.appendChild(srvEl);
            details.appendChild(usrEl);

            var passRow = document.createElement('div');
            passRow.className = 'playlist-pass-row';
            var passLabel = document.createElement('span');
            passLabel.textContent = 'Contraseña: ';
            var passVal = document.createElement('span');
            passVal.className = 'playlist-pass-val';
            var rawPass = pl.password || pl.pass || '';
            var isRevealed = false;
            passVal.textContent = rawPass ? '••••••••' : '--';

            passRow.appendChild(passLabel);
            passRow.appendChild(passVal);
            if (rawPass) {
                var btnEye = document.createElement('button');
                btnEye.type = 'button';
                btnEye.className = 'btn-toggle-eye-mini';
                btnEye.setAttribute('aria-label', 'Mostrar u ocultar contraseña');
                btnEye.textContent = '👁️';
                btnEye.onclick = function () {
                    isRevealed = !isRevealed;
                    passVal.textContent = isRevealed ? rawPass : '••••••••';
                };
                passRow.appendChild(btnEye);
            }
            details.appendChild(passRow);
            card.appendChild(details);

            var actions = document.createElement('div');
            actions.className = 'playlist-actions';

            if (!pl.is_default) {
                var btnMakeDefault = document.createElement('button');
                btnMakeDefault.className = 'btn btn-secondary';
                btnMakeDefault.textContent = 'Marcar Principal';
                btnMakeDefault.onclick = function () {
                    masterMakePlaylistDefault(pl);
                };
                actions.appendChild(btnMakeDefault);
            }

            var btnEdit = document.createElement('button');
            btnEdit.className = 'btn btn-secondary';
            btnEdit.textContent = 'Editar';
            btnEdit.onclick = function () {
                openPlaylistModal('master', pl);
            };
            actions.appendChild(btnEdit);

            var btnCopy = document.createElement('button');
            btnCopy.className = 'btn btn-secondary';
            btnCopy.textContent = '📋 Copiar a TV';
            btnCopy.onclick = function () {
                openCopyPlaylistModal(pl);
            };
            actions.appendChild(btnCopy);

            var btnDel = document.createElement('button');
            btnDel.className = 'btn btn-danger';
            btnDel.textContent = 'Eliminar';
            btnDel.onclick = function () {
                masterDeletePlaylist(pl);
            };
            actions.appendChild(btnDel);

            card.appendChild(actions);
            container.appendChild(card);
        });
    }

    async function masterMakePlaylistDefault(pl) {
        if (!state.activeMasterDevice) return;
        var dev = state.activeMasterDevice;
        var devKey = dev.key || dev.device_key || '';
        try {
            var payload = {
                p_password: state.masterPassword,
                p_mac: dev.mac,
                p_id: pl.id,
                p_name: pl.name,
                p_server: pl.server,
                p_user: pl.username,
                p_pass: pl.password,
                p_is_default: true
            };
            var res = null;
            try {
                res = await callRpc('master_upsert_playlist', payload);
            } catch (e) {
                if (devKey) {
                    res = await callRpc('ibo_upsert_playlist', {
                        p_id: pl.id,
                        p_mac: dev.mac,
                        p_key: devKey,
                        p_name: pl.name,
                        p_server: pl.server,
                        p_user: pl.username,
                        p_pass: pl.password,
                        p_is_default: true
                    });
                } else {
                    throw e;
                }
            }
            if (res && res.ok) {
                showToast('Lista principal actualizada', 'success');
                await loadMasterDevicePlaylists();
                await loadMasterDevices();
            } else {
                showToast('Error al actualizar lista', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    }

    async function masterDeletePlaylist(pl) {
        if (!state.activeMasterDevice) return;
        if (!confirm('¿Eliminar la lista "' + pl.name + '"?')) return;
        var dev = state.activeMasterDevice;
        var devKey = dev.key || dev.device_key || '';

        try {
            var res = null;
            try {
                res = await callRpc('master_delete_playlist', {
                    p_password: state.masterPassword,
                    p_mac: dev.mac,
                    p_id: pl.id
                });
            } catch (e) {
                if (devKey) {
                    res = await callRpc('ibo_delete_playlist', {
                        p_mac: dev.mac,
                        p_key: devKey,
                        p_id: pl.id
                    });
                } else {
                    throw e;
                }
            }
            if (res && res.ok) {
                showToast('Lista eliminada', 'success');
                await loadMasterDevicePlaylists();
                await loadMasterDevices();
            } else {
                showToast('Error al eliminar lista', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    }

    // ============================================================
    // 6. MODAL COMÚN DE LISTA XTREAM
    // ============================================================
    function openPlaylistModal(mode, plItem) {
        var targetDev = (mode === 'master') ? state.activeMasterDevice : state.iboDevice;
        var macField = document.getElementById('modalPlaylistTargetMac');
        var targetMac = (targetDev && targetDev.mac) ? targetDev.mac : (macField ? macField.value : '');

        state.playlistModalContext = {
            mode: mode,
            item: plItem || null,
            targetDevice: targetDev || null
        };

        if (macField && targetMac) {
            macField.value = targetMac;
        }

        var modal = document.getElementById('modalPlaylist');
        var title = document.getElementById('modalPlaylistTitle');
        var idField = document.getElementById('modalPlaylistId');
        var nameField = document.getElementById('modalPlName');
        var serverField = document.getElementById('modalPlServer');
        var userField = document.getElementById('modalPlUser');
        var passField = document.getElementById('modalPlPass');
        var defField = document.getElementById('modalPlDefault');

        if (title) title.textContent = plItem ? 'Editar Lista Xtream' : 'Añadir Lista Xtream';
        if (idField) idField.value = plItem ? plItem.id : '';
        if (nameField) nameField.value = plItem ? plItem.name : '';
        if (serverField) serverField.value = plItem ? plItem.server : '';
        if (userField) userField.value = plItem ? (plItem.username || plItem.user || '') : '';
        if (passField) {
            passField.value = plItem ? (plItem.password || plItem.pass || '') : '';
            passField.type = 'password';
        }
        if (defField) defField.checked = plItem ? Boolean(plItem.is_default) : false;

        if (modal) modal.className = 'modal-overlay';
    }

    function closePlaylistModal() {
        state.playlistModalContext = null;
        var modal = document.getElementById('modalPlaylist');
        if (modal) modal.className = 'modal-overlay hidden';
    }

    async function handleSavePlaylistModal(e) {
        if (e && e.preventDefault) e.preventDefault();
        var ctx = state.playlistModalContext;
        if (!ctx) return;

        var idVal = document.getElementById('modalPlaylistId').value || null;
        var name = document.getElementById('modalPlName').value.trim();
        var server = document.getElementById('modalPlServer').value.trim();
        var user = document.getElementById('modalPlUser').value.trim();
        var pass = document.getElementById('modalPlPass').value.trim();
        var isDef = document.getElementById('modalPlDefault').checked;
        var saveBtn = document.getElementById('btnSavePlaylistModal');

        if (!name || !server || !user || !pass) {
            showToast('Todos los campos son obligatorios', 'error');
            return;
        }

        if (!/^https?:\/\//i.test(server)) {
            showToast('El servidor debe comenzar con http:// o https://', 'error');
            return;
        }

        if (saveBtn) saveBtn.disabled = true;

        try {
            if (ctx.mode === 'ibo') {
                if (!state.iboDevice) throw new Error('No hay sesión IBO');
                var payloadIbo = {
                    p_id: idVal,
                    p_mac: state.iboDevice.mac,
                    p_key: state.iboDevice.key,
                    p_name: name,
                    p_server: server,
                    p_user: user,
                    p_pass: pass,
                    p_is_default: isDef
                };
                var resIbo = await callRpc('ibo_upsert_playlist', payloadIbo);
                if (resIbo && resIbo.ok) {
                    showToast('Lista guardada con éxito', 'success');
                    closePlaylistModal();
                    await refreshIboDevice();
                } else {
                    showToast('Error al guardar la lista', 'error');
                }
            } else if (ctx.mode === 'master') {
                var macInput = document.getElementById('modalPlaylistTargetMac');
                var macVal = (macInput && macInput.value) ? macInput.value.trim() : '';
                var targetDev = ctx.targetDevice || state.activeMasterDevice;
                var finalMac = (targetDev && targetDev.mac) ? targetDev.mac : macVal;

                if (!finalMac) {
                    throw new Error('No se pudo identificar el televisor destino para guardar la lista');
                }

                var devKey = (targetDev && (targetDev.key || targetDev.device_key)) || '';

                var payloadMaster = {
                    p_password: state.masterPassword,
                    p_mac: finalMac,
                    p_id: idVal,
                    p_name: name,
                    p_server: server,
                    p_user: user,
                    p_pass: pass,
                    p_is_default: isDef
                };

                var resMaster = null;
                try {
                    resMaster = await callRpc('master_upsert_playlist', payloadMaster);
                } catch (rpcErr) {
                    if (devKey) {
                        resMaster = await callRpc('ibo_upsert_playlist', {
                            p_id: idVal,
                            p_mac: finalMac,
                            p_key: devKey,
                            p_name: name,
                            p_server: server,
                            p_user: user,
                            p_pass: pass,
                            p_is_default: isDef
                        });
                    } else {
                        throw rpcErr;
                    }
                }

                if (resMaster && resMaster.ok) {
                    showToast('Lista guardada en televisor', 'success');
                    closePlaylistModal();
                    await loadMasterDevicePlaylists();
                    await loadMasterDevices();
                    if (state.masterDevices && targetDev) {
                        for (var i = 0; i < state.masterDevices.length; i++) {
                            if (state.masterDevices[i].mac === targetDev.mac) {
                                state.activeMasterDevice = state.masterDevices[i];
                                renderMasterDeviceDetailSummary(state.activeMasterDevice);
                                break;
                            }
                        }
                    }
                } else if (devKey) {
                    var resFallback = await callRpc('ibo_upsert_playlist', {
                        p_id: idVal,
                        p_mac: finalMac,
                        p_key: devKey,
                        p_name: name,
                        p_server: server,
                        p_user: user,
                        p_pass: pass,
                        p_is_default: isDef
                    });
                    if (resFallback && resFallback.ok) {
                        showToast('Lista guardada en televisor', 'success');
                        closePlaylistModal();
                        await loadMasterDevicePlaylists();
                        await loadMasterDevices();
                        if (state.masterDevices && targetDev) {
                            for (var j = 0; j < state.masterDevices.length; j++) {
                                if (state.masterDevices[j].mac === targetDev.mac) {
                                    state.activeMasterDevice = state.masterDevices[j];
                                    renderMasterDeviceDetailSummary(state.activeMasterDevice);
                                    break;
                                }
                            }
                        }
                    } else {
                        var errMsg = (resFallback && resFallback.error) || (resMaster && resMaster.error) || 'Error al guardar lista en televisor';
                        showToast(errMsg, 'error');
                    }
                } else {
                    var errMsgMaster = (resMaster && resMaster.error) ? resMaster.error : 'Error al guardar lista en televisor';
                    showToast(errMsgMaster, 'error');
                }
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    // ============================================================
    // 6. CAMBIO MASIVO DE SERVIDOR Y COPIAR LISTA ENTRE TVs
    // ============================================================
    function openBulkServerModal() {
        var modal = document.getElementById('modalBulkServer');
        if (!modal) return;

        var serversSet = {};
        state.masterDevices.forEach(function (d) {
            if (d.playlists && Array.isArray(d.playlists)) {
                d.playlists.forEach(function (p) {
                    if (p.server) {
                        var s = p.server.trim();
                        serversSet[s] = true;
                    }
                });
            }
        });

        var dataList = document.getElementById('bulkOldServerList');
        if (dataList) {
            dataList.innerHTML = '';
            Object.keys(serversSet).sort().forEach(function (srv) {
                var opt = document.createElement('option');
                opt.value = srv;
                dataList.appendChild(opt);
            });
        }

        var oldInput = document.getElementById('bulkOldServer');
        var newInput = document.getElementById('bulkNewServer');
        if (oldInput) oldInput.value = '';
        if (newInput) newInput.value = '';

        updateBulkServerPreview('');
        modal.classList.remove('hidden');
    }

    function closeBulkServerModal() {
        var modal = document.getElementById('modalBulkServer');
        if (modal) modal.classList.add('hidden');
    }

    function updateBulkServerPreview(targetServer) {
        var box = document.getElementById('bulkPreviewBox');
        if (!box) return;

        var clean = (targetServer || '').trim().toLowerCase();
        if (!clean || clean.length < 4) {
            box.className = 'bulk-preview-box';
            box.textContent = 'Introduce el servidor actual para calcular las listas afectadas.';
            return;
        }

        var affectedPlaylists = 0;
        var affectedDevices = 0;

        state.masterDevices.forEach(function (d) {
            var devHasMatch = false;
            if (d.playlists && Array.isArray(d.playlists)) {
                d.playlists.forEach(function (p) {
                    if (p.server && p.server.toLowerCase().trim() === clean) {
                        affectedPlaylists++;
                        devHasMatch = true;
                    }
                });
            }
            if (devHasMatch) affectedDevices++;
        });

        if (affectedPlaylists > 0) {
            box.className = 'bulk-preview-box match';
            box.innerHTML = 'Se actualizarán <strong>' + affectedPlaylists + (affectedPlaylists === 1 ? ' lista</strong> en ' : ' listas</strong> en ') +
                            '<strong>' + affectedDevices + (affectedDevices === 1 ? ' televisor</strong>' : ' televisores</strong>') +
                            ' (manteniendo sus usuarios y contraseñas intactos).';
        } else {
            box.className = 'bulk-preview-box';
            box.textContent = 'No se han detectado listas con esa URL de servidor en las TVs cargadas (se enviará igualmente la orden al servidor).';
        }
    }

    async function handleBulkServerSubmit(e) {
        if (e && e.preventDefault) e.preventDefault();
        var oldUrl = document.getElementById('bulkOldServer').value.trim();
        var newUrl = document.getElementById('bulkNewServer').value.trim();
        var applyBtn = document.getElementById('btnApplyBulkServer');

        if (!oldUrl || !newUrl) {
            showToast('Introduce el servidor actual y el nuevo servidor', 'error');
            return;
        }

        if (!/^https?:\/\//i.test(newUrl)) {
            showToast('El nuevo servidor debe comenzar con http:// o https://', 'error');
            return;
        }

        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.textContent = 'Actualizando...';
        }

        try {
            var payload = {
                p_password: state.masterPassword,
                p_old_url: oldUrl,
                p_new_url: newUrl
            };
            var res = await callRpc('master_replace_server_url', payload);
            if (res && res.ok !== false) {
                var count = (res.updated_count !== undefined) ? res.updated_count : (typeof res === 'number' ? res : 'todas las');
                showToast('Servidor actualizado: ' + count + ' listas modificadas', 'success');
                closeBulkServerModal();
                await loadMasterDevices();
                if (state.activeMasterDevice) {
                    loadMasterDevicePlaylists();
                }
            } else {
                var errMsg = (res && res.error) ? res.error : 'Error al cambiar servidor masivo';
                showToast(errMsg, 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.textContent = 'Aplicar cambio masivo';
            }
        }
    }

    function openCopyPlaylistModal(pl) {
        state.copyingPlaylist = pl;
        var modal = document.getElementById('modalCopyPlaylist');
        if (!modal) return;

        var sourceDisplay = document.getElementById('copyPlaylistSourceName');
        if (sourceDisplay) {
            sourceDisplay.textContent = (pl.name || 'Lista sin nombre') + ' · ' + maskServerUrl(pl.server);
        }

        var select = document.getElementById('copyTargetDeviceSelect');
        var warnBox = document.getElementById('copyWarningBox');
        var confirmBtn = document.getElementById('btnConfirmCopyPlaylist');
        var isDefCheck = document.getElementById('copyPlaylistIsDefault');

        if (isDefCheck) isDefCheck.checked = false;

        var activeMac = state.activeMasterDevice ? state.activeMasterDevice.mac : '';
        var candidateDevs = state.masterDevices.filter(function (d) {
            return d.mac !== activeMac;
        });

        if (select) select.innerHTML = '';

        if (candidateDevs.length === 0) {
            if (warnBox) warnBox.classList.remove('hidden');
            if (select) select.disabled = true;
            if (confirmBtn) confirmBtn.disabled = true;
        } else {
            if (warnBox) warnBox.classList.add('hidden');
            if (select) {
                select.disabled = false;
                candidateDevs.forEach(function (d) {
                    var opt = document.createElement('option');
                    opt.value = d.mac;
                    opt.textContent = (d.alias || 'Sin alias') + ' (' + d.mac + ')';
                    select.appendChild(opt);
                });
            }
            if (confirmBtn) confirmBtn.disabled = false;
        }

        modal.classList.remove('hidden');
    }

    function closeCopyPlaylistModal() {
        state.copyingPlaylist = null;
        var modal = document.getElementById('modalCopyPlaylist');
        if (modal) modal.classList.add('hidden');
    }

    async function handleCopyPlaylistSubmit(e) {
        if (e && e.preventDefault) e.preventDefault();
        var pl = state.copyingPlaylist;
        if (!pl) return;

        var select = document.getElementById('copyTargetDeviceSelect');
        var targetMac = select ? select.value : '';
        if (!targetMac) {
            showToast('Selecciona un televisor destino', 'error');
            return;
        }

        var isDefault = !!(document.getElementById('copyPlaylistIsDefault') && document.getElementById('copyPlaylistIsDefault').checked);
        var confirmBtn = document.getElementById('btnConfirmCopyPlaylist');

        var targetDev = null;
        for (var i = 0; i < state.masterDevices.length; i++) {
            if (state.masterDevices[i].mac === targetMac) {
                targetDev = state.masterDevices[i];
                break;
            }
        }
        var devKey = (targetDev && (targetDev.key || targetDev.device_key)) || '';

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Copiando...';
        }

        try {
            var payload = {
                p_password: state.masterPassword,
                p_mac: targetMac,
                p_id: null,
                p_name: pl.name,
                p_server: pl.server,
                p_user: pl.username || pl.user || '',
                p_pass: pl.password || pl.pass || '',
                p_is_default: isDefault
            };

            var res = null;
            try {
                res = await callRpc('master_upsert_playlist', payload);
            } catch (rpcErr) {
                if (devKey) {
                    res = await callRpc('ibo_upsert_playlist', {
                        p_id: null,
                        p_mac: targetMac,
                        p_key: devKey,
                        p_name: pl.name,
                        p_server: pl.server,
                        p_user: pl.username || pl.user || '',
                        p_pass: pl.password || pl.pass || '',
                        p_is_default: isDefault
                    });
                } else {
                    throw rpcErr;
                }
            }

            if (res && res.ok !== false) {
                var destName = (targetDev && targetDev.alias) ? targetDev.alias : targetMac;
                showToast('Lista copiada con éxito a ' + destName, 'success');
                closeCopyPlaylistModal();
                await loadMasterDevices();
            } else {
                var errMsg = (res && res.error) ? res.error : 'Error al copiar lista al televisor destino';
                showToast(errMsg, 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Copiar Lista';
            }
        }
    }

    // ============================================================
    // 7. INICIALIZACIÓN Y EVENT LISTENERS
    // ============================================================
    function init() {
        // Indicador de versión visual para verificación de despliegue y caché
        var bBadge = document.getElementById('brandBadge') || document.querySelector('.brand-badge');
        if (bBadge) {
            bBadge.textContent = 'PORTAL REMOTO · v3.6.0';
        }

        // Selector de Pestañas
        var tabIbo = document.getElementById('tabBtnIbo');
        var tabMaster = document.getElementById('tabBtnMaster');
        if (tabIbo) tabIbo.addEventListener('click', function () { setTab('ibo'); });
        if (tabMaster) tabMaster.addEventListener('click', function () { setTab('master'); });

        // Auto-formato de MAC en formulario IBO
        var macInput = document.getElementById('iboInputMac');
        if (macInput) {
            macInput.addEventListener('input', function () {
                var pos = this.selectionStart;
                var formatted = formatMacInput(this.value);
                this.value = formatted;
            });
        }

        // Formularios
        var formIbo = document.getElementById('formIboAuth');
        if (formIbo) formIbo.addEventListener('submit', handleIboLogin);

        var btnIboLogout = document.getElementById('btnIboLogout');
        if (btnIboLogout) btnIboLogout.addEventListener('click', handleIboLogout);

        var btnIboAddPl = document.getElementById('btnIboAddPlaylist');
        if (btnIboAddPl) btnIboAddPl.addEventListener('click', function () {
            openPlaylistModal('ibo', null);
        });

        var formMaster = document.getElementById('formMasterAuth');
        if (formMaster) formMaster.addEventListener('submit', handleMasterLogin);

        var btnMasterRefresh = document.getElementById('btnMasterRefresh');
        if (btnMasterRefresh) btnMasterRefresh.addEventListener('click', loadMasterDevices);

        var btnMasterLogout = document.getElementById('btnMasterLogout');
        if (btnMasterLogout) btnMasterLogout.addEventListener('click', handleMasterLogout);

        var btnBackToDevs = document.getElementById('btnMasterBackToDevices');
        if (btnBackToDevs) btnBackToDevs.addEventListener('click', closeMasterDeviceDetail);

        var btnMasterAddPl = document.getElementById('btnMasterAddPlaylistForDevice');
        if (btnMasterAddPl) btnMasterAddPl.addEventListener('click', function () {
            openPlaylistModal('master', null);
        });

        // Buscador y Filtros en Panel Maestro
        var searchInput = document.getElementById('masterSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                state.masterFilters.search = this.value;
                renderMasterDashboard();
            });
        }

        var filterStatus = document.getElementById('masterFilterStatus');
        if (filterStatus) {
            filterStatus.addEventListener('change', function () {
                state.masterFilters.status = this.value;
                renderMasterDashboard();
            });
        }

        var filterPlatform = document.getElementById('masterFilterPlatform');
        if (filterPlatform) {
            filterPlatform.addEventListener('change', function () {
                state.masterFilters.platform = this.value;
                renderMasterDashboard();
            });
        }

        var sortSelect = document.getElementById('masterSortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', function () {
                state.masterFilters.sort = this.value;
                renderMasterDashboard();
            });
        }

        var btnOpenBulk = document.getElementById('btnOpenBulkServerModal');
        if (btnOpenBulk) btnOpenBulk.addEventListener('click', openBulkServerModal);

        // Modales
        var btnCancelPl = document.getElementById('btnCancelPlaylistModal');
        if (btnCancelPl) btnCancelPl.addEventListener('click', closePlaylistModal);

        var formPl = document.getElementById('formPlaylistModal');
        if (formPl) formPl.addEventListener('submit', handleSavePlaylistModal);

        var btnCancelDev = document.getElementById('btnCancelEditDeviceModal');
        if (btnCancelDev) btnCancelDev.addEventListener('click', closeEditDeviceModal);

        var formDev = document.getElementById('formEditDeviceModal');
        if (formDev) formDev.addEventListener('submit', handleSaveDevice);

        // Modal Cambio Masivo de Servidor
        var btnCancelBulk = document.getElementById('btnCancelBulkServer');
        if (btnCancelBulk) btnCancelBulk.addEventListener('click', closeBulkServerModal);

        var formBulk = document.getElementById('formBulkServerModal');
        if (formBulk) formBulk.addEventListener('submit', handleBulkServerSubmit);

        var bulkOldInput = document.getElementById('bulkOldServer');
        if (bulkOldInput) {
            bulkOldInput.addEventListener('input', function () {
                updateBulkServerPreview(this.value);
            });
        }

        // Modal Copiar Lista a otra TV
        var btnCancelCopy = document.getElementById('btnCancelCopyPlaylist');
        if (btnCancelCopy) btnCancelCopy.addEventListener('click', closeCopyPlaylistModal);

        var formCopy = document.getElementById('formCopyPlaylistModal');
        if (formCopy) formCopy.addEventListener('submit', handleCopyPlaylistSubmit);

        // Ojos de contraseña
        var btnEyeMaster = document.getElementById('btnToggleMasterPass');
        if (btnEyeMaster) {
            btnEyeMaster.addEventListener('click', function () {
                var inp = document.getElementById('masterInputPass');
                if (inp) inp.type = (inp.type === 'password' ? 'text' : 'password');
            });
        }

        var btnEyePl = document.getElementById('btnTogglePlPass');
        if (btnEyePl) {
            btnEyePl.addEventListener('click', function () {
                var inp = document.getElementById('modalPlPass');
                if (inp) inp.type = (inp.type === 'password' ? 'text' : 'password');
            });
        }

        // PWA Service Worker desactivado para evitar problemas de caché
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
