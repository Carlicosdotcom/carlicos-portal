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
        playlistModalContext: null // { mode: 'ibo' | 'master', item: null }
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

    function renderMasterDashboard() {
        var loginForm = document.getElementById('masterLoginForm');
        var dashboard = document.getElementById('masterDashboard');
        var listView = document.getElementById('masterDevicesListView');
        var detailView = document.getElementById('masterDeviceDetailView');

        if (!state.masterPassword) {
            if (loginForm) loginForm.style.display = 'block';
            if (dashboard) dashboard.className = 'hidden';
            return;
        }

        if (loginForm) loginForm.style.display = 'none';
        if (dashboard) dashboard.className = '';

        // Mantener o restaurar la sub-vista adecuada
        if (state.activeMasterDevice) {
            if (listView) listView.className = 'hidden';
            if (detailView) detailView.className = '';
            renderMasterDeviceDetailSummary(state.activeMasterDevice);
        } else {
            if (listView) listView.className = '';
            if (detailView) detailView.className = 'hidden';
        }

        var countEl = document.getElementById('masterDeviceCount');
        if (countEl) countEl.textContent = state.masterDevices.length;

        var container = document.getElementById('masterDevicesList');
        if (!container) return;
        container.innerHTML = '';

        if (state.masterDevices.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay televisores registrados todavía.</div>';
            return;
        }

        state.masterDevices.forEach(function (dev) {
            var card = document.createElement('div');
            card.className = 'master-device-card';

            // Cabecera de la tarjeta: Alias y Badge de estado
            var header = document.createElement('div');
            header.className = 'master-device-header';

            var aliasEl = document.createElement('span');
            aliasEl.className = 'master-device-alias' + (!dev.alias ? ' no-alias' : '');
            aliasEl.textContent = dev.alias || 'Sin alias configurado';
            header.appendChild(aliasEl);

            var badge = document.createElement('span');
            badge.className = 'status-badge ' + (dev.is_active ? 'active' : 'paused');
            badge.textContent = dev.is_active ? 'ACTIVA' : 'PAUSADA';
            header.appendChild(badge);

            card.appendChild(header);

            // Metadatos
            var metaRow = document.createElement('div');
            metaRow.className = 'master-meta-row';

            var plCount = (dev.playlists_count !== undefined) ? dev.playlists_count : ((dev.playlists && dev.playlists.length) || 0);

            metaRow.innerHTML = 
                '<div class="master-meta-item mono"><strong>MAC:</strong> ' + dev.mac + '</div>' +
                '<div class="master-meta-item mono"><strong>Device Key:</strong> ' + (dev.key || dev.device_key || '------') + '</div>' +
                '<div class="master-meta-item"><strong>Plataforma:</strong> ' + (dev.platform || 'samsung-tizen') + ' v' + (dev.app_version || '3.5.0') + '</div>' +
                '<div class="master-meta-item"><strong>Última conex.:</strong> ' + formatDate(dev.last_seen) + '</div>' +
                '<div class="master-meta-item"><strong>Listas Xtream:</strong> ' + plCount + '</div>';

            card.appendChild(metaRow);

            // Acciones
            var actions = document.createElement('div');
            actions.className = 'master-device-actions';

            var btnEditDev = document.createElement('button');
            btnEditDev.className = 'btn btn-secondary';
            btnEditDev.textContent = 'Editar TV';
            btnEditDev.onclick = function () {
                openEditDeviceModal(dev);
            };
            actions.appendChild(btnEditDev);

            var btnManagePl = document.createElement('button');
            btnManagePl.className = 'btn btn-primary';
            btnManagePl.textContent = 'Gestionar Listas';
            btnManagePl.onclick = function () {
                openMasterDeviceDetail(dev);
            };
            actions.appendChild(btnManagePl);

            var btnDelDev = document.createElement('button');
            btnDelDev.className = 'btn btn-danger';
            btnDelDev.textContent = 'Eliminar TV';
            btnDelDev.onclick = function () {
                masterDeleteDevice(dev);
            };
            actions.appendChild(btnDelDev);

            card.appendChild(actions);
            container.appendChild(card);
        });
    }

    function handleMasterLogout() {
        state.masterPassword = '';
        sessionStorage.removeItem('carlicos_master_session');
        state.masterDevices = [];
        state.activeMasterDevice = null;
        closePlaylistModal();
        closeEditDeviceModal();
        var listView = document.getElementById('masterDevicesListView');
        var detailView = document.getElementById('masterDeviceDetailView');
        if (listView) listView.className = '';
        if (detailView) detailView.className = 'hidden';
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
        if (listView) listView.className = 'hidden';
        if (detailView) detailView.className = '';

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
        if (listView) listView.className = '';
        if (detailView) detailView.className = 'hidden';
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
    // 7. INICIALIZACIÓN Y EVENT LISTENERS
    // ============================================================
    function init() {
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

        // Modales
        var btnCancelPl = document.getElementById('btnCancelPlaylistModal');
        if (btnCancelPl) btnCancelPl.addEventListener('click', closePlaylistModal);

        var formPl = document.getElementById('formPlaylistModal');
        if (formPl) formPl.addEventListener('submit', handleSavePlaylistModal);

        var btnCancelDev = document.getElementById('btnCancelEditDeviceModal');
        if (btnCancelDev) btnCancelDev.addEventListener('click', closeEditDeviceModal);

        var formDev = document.getElementById('formEditDeviceModal');
        if (formDev) formDev.addEventListener('submit', handleSaveDevice);

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
