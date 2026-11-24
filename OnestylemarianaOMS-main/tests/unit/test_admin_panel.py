# tests/unit/test_admin_panel.py
"""
Pruebas del Panel Administrativo SPA (#admin):
- Renovación de token con rotación (POST /api/auth/refresh)
- Paginación real del lado del servidor (GET /api/admin/pedidos, GET /api/admin/productos)
- Dashboard agregado (GET /api/admin/dashboard)
Trazabilidad: RF-SEG-006/008/009, RF-PED-002/004, RF-CAT-004/007.
"""
from run import app

ADMIN = {"email": "admin@onestylemariana.co", "contrasena": "AdminOneStyle2026"}


def _login_admin(client):
    res = client.post("/api/auth/login", json=ADMIN)
    assert res.status_code == 200
    return res.get_json()["data"]


def _crear_pedido(client, session_id, variante_id, nombre):
    h = {"X-Session-ID": session_id}
    assert client.post("/api/carrito/items", headers=h, json={"fk_id_variante": variante_id, "cantidad": 1}).status_code == 201
    res = client.post("/api/pedidos/checkout", headers=h, json={
        "nombre_receptor": nombre,
        "email": f"{session_id}@test.co",
        "direccion_envio": "Calle 1 # 2-3",
        "barrio": "Centro",
        "ciudad": "Bogotá D.C.",
        "telefono": "3101234567",
    })
    assert res.status_code == 201
    return res.get_json()["data"]


def test_refresh_token_rotacion_y_revocacion_del_par_anterior():
    client = app.test_client()
    data = _login_admin(client)
    assert data["refresh_token"] and data["expires_in"] > 0
    old_access, old_refresh = data["token"], data["refresh_token"]

    res = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert res.status_code == 200
    nuevo = res.get_json()["data"]
    assert nuevo["token"] != old_access
    assert nuevo["refresh_token"] != old_refresh

    # El nuevo access funciona y el anterior quedó revocado
    assert client.get("/api/perfil", headers={"Authorization": f"Bearer {nuevo['token']}"}).status_code == 200
    assert client.get("/api/perfil", headers={"Authorization": f"Bearer {old_access}"}).status_code == 401

    # El refresh es de un solo uso
    assert client.post("/api/auth/refresh", json={"refresh_token": old_refresh}).status_code == 401


def test_refresh_token_invalido_vencido_o_ausente():
    client = app.test_client()
    assert client.post("/api/auth/refresh", json={"refresh_token": "no-existe"}).status_code == 401
    assert client.post("/api/auth/refresh", json={}).status_code == 400

    from run import auth_service
    from datetime import datetime, timedelta
    data = _login_admin(client)
    auth_service.refresh_tokens[data["refresh_token"]]["expires_at"] = datetime.now() - timedelta(seconds=1)
    assert client.post("/api/auth/refresh", json={"refresh_token": data["refresh_token"]}).status_code == 401


def test_logout_revoca_refresh_token():
    client = app.test_client()
    data = _login_admin(client)
    h = {"Authorization": f"Bearer {data['token']}"}
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": data["refresh_token"]}).status_code == 401


def test_pedidos_paginacion_servidor_filtros_y_rbac():
    client = app.test_client()
    for i, var in enumerate((1, 2, 3)):
        _crear_pedido(client, f"pag-sess-{i}", var, f"Clienta Paginada {i}")

    token = _login_admin(client)["token"]
    h = {"Authorization": f"Bearer {token}"}

    p1 = client.get("/api/admin/pedidos?page=1&per_page=2", headers=h).get_json()["data"]
    assert len(p1["items"]) == 2
    assert p1["total"] >= 3 and p1["has_next"] is True and p1["has_prev"] is False
    p2 = client.get("/api/admin/pedidos?page=2&per_page=2", headers=h).get_json()["data"]
    assert p2["has_prev"] is True
    assert {i["id_pedido"] for i in p1["items"]}.isdisjoint({i["id_pedido"] for i in p2["items"]})

    # Búsqueda en vivo y filtro por estado
    busq = client.get("/api/admin/pedidos?q=Paginada 1", headers=h).get_json()["data"]
    assert busq["total"] == 1
    assert client.get("/api/admin/pedidos?estado=Entregado", headers=h).get_json()["data"]["total"] == 0

    # Entradas inválidas y acceso no autorizado
    assert client.get("/api/admin/pedidos?page=0", headers=h).status_code == 400
    assert client.get("/api/admin/pedidos?page=abc", headers=h).status_code == 400
    assert client.get("/api/admin/pedidos?estado=Inventado", headers=h).status_code == 400
    assert client.get("/api/admin/pedidos").status_code == 401


def test_dashboard_agregado_y_proteccion_rbac():
    client = app.test_client()
    assert client.get("/api/admin/dashboard").status_code == 401

    # Una clienta no puede acceder (403)
    reg = client.post("/api/auth/register", json={
        "nombre": "Cli", "apellido": "Ente", "email": "dash.clienta@test.co", "contrasena": "ClaveSegura123"
    })
    tok_cli = reg.get_json()["data"]["token"]
    assert client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {tok_cli}"}).status_code == 403

    token = _login_admin(client)["token"]
    res = client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    d = res.get_json()["data"]
    for clave in ("pedidos", "inventario", "catalogo", "soporte", "pedidos_recientes"):
        assert clave in d
    assert {"pedidos_pendientes", "ventas_totales", "conteo_por_estado"} <= set(d["pedidos"])
    assert {"alertas_total", "agotadas", "stock_bajo"} <= set(d["inventario"])


def test_productos_admin_paginados_y_redireccion_del_prototipo():
    client = app.test_client()
    token = _login_admin(client)["token"]
    h = {"Authorization": f"Bearer {token}"}
    data = client.get("/api/admin/productos?page=1&per_page=4", headers=h).get_json()["data"]
    assert len(data["items"]) <= 4 and data["total"] >= 9 and data["total_pages"] >= 3
    assert client.get("/api/admin/productos?per_page=0", headers=h).status_code == 400

    res = client.get("/admin/catalogo")
    assert res.status_code == 302 and "#/admin/catalogo" in res.headers["Location"]


def test_cambio_de_password_autenticado_validaciones():
    client = app.test_client()
    token = _login_admin(client)["token"]
    h = {"Authorization": f"Bearer {token}"}

    assert client.put("/api/perfil/password", json={"contrasena_actual": "x", "nueva_password": "NuevaPassword1!"}).status_code == 401
    assert client.put("/api/perfil/password", headers=h, json={"contrasena_actual": "Incorrecta!", "nueva_password": "NuevaPassword1!"}).status_code == 400
    assert client.put("/api/perfil/password", headers=h, json={"contrasena_actual": ADMIN["contrasena"], "nueva_password": "123"}).status_code == 400

    r_ok = client.put("/api/perfil/password", headers=h, json={"contrasena_actual": ADMIN["contrasena"], "nueva_password": "AdminNueva99!"})
    assert r_ok.status_code == 200
    client.put("/api/perfil/password", headers=h, json={"contrasena_actual": "AdminNueva99!", "nueva_password": ADMIN["contrasena"]})


def test_owasp_zap_csp_sin_unsafe_inline_directivas_sin_fallback_y_sri():
    import re
    client = app.test_client()
    r1 = client.get("/")
    r2 = client.get("/")
    assert r1.status_code == 200

    csp1 = r1.headers.get("Content-Security-Policy", "")
    csp2 = r2.headers.get("Content-Security-Policy", "")

    # 1. Sin unsafe-inline en script-src ni style-src
    assert "'unsafe-inline'" not in csp1

    # 2. Directivas sin fallback definidas explícitamente
    assert "frame-ancestors 'self'" in csp1
    assert "form-action 'self'" in csp1
    assert "base-uri 'self'" in csp1

    # 3. Nonce criptográfico único por petición
    m1 = re.search(r"'nonce-([A-Za-z0-9_\-]+)'", csp1)
    m2 = re.search(r"'nonce-([A-Za-z0-9_\-]+)'", csp2)
    assert m1 and m2 and m1.group(1) != m2.group(1)

    # 4. Todos los recursos externos en HTML poseen integrity="sha384-..." y crossorigin="anonymous"
    html = r1.get_data(as_text=True)
    external_tags = re.findall(r"<(?:script|link)\b[^>]+(?:src|href)=\"https?://[^\"]+\"[^>]*>", html)
    assert len(external_tags) >= 3
    for tag in external_tags:
        assert 'integrity="sha384-' in tag
        assert 'crossorigin="anonymous"' in tag

    # 5. Cero bloques <style> o atributos style= inline en plantillas
    assert "<style" not in html
    assert 'style="' not in html

    # 6. Endpoint GET /api/productos/categorias devuelve las 6 categorías reales del catálogo
    rc = client.get("/api/productos/categorias")
    assert rc.status_code == 200
    cats = rc.get_json()["data"]
    assert len(cats) >= 6
    for c in cats:
        assert {"id_categoria", "nombre_categoria", "slug", "imagen_representativa", "total_productos"} <= set(c.keys())

    # 7. Logo oficial img/logo.jpg presente en la plantilla y colores r/n/ros/b con imagen por variante
    assert 'src="img/logo.jpg"' in html
    r_ves = client.get("/api/catalogo/vestido-imperial")
    assert r_ves.status_code == 200
    ves_data = r_ves.get_json()["data"]
    colores_ves = {c["slug"]: c["imagen_url"] for c in ves_data["colores"]}
    assert colores_ves.get("blanco") == "img/vestidoamericanoB.jpg"
    assert colores_ves.get("negro") == "img/vestidoamericanoN.jpg"
    assert colores_ves.get("rojo") == "img/vestidoamericanoR.jpg"


def test_admin_atributos_creacion_categorias_tallas_colores_y_rbac():
    client = app.test_client()

    # 1. Sin autenticación -> 401
    assert client.get("/api/admin/atributos").status_code == 401
    assert client.post("/api/admin/categorias", json={"nombre_categoria": "Casual"}).status_code == 401
    assert client.post("/api/admin/tallas", json={"nombre_talla": "XXL"}).status_code == 401
    assert client.post("/api/admin/colores", json={"nombre_color": "Cyan", "codigo_hex": "#00FFFF"}).status_code == 401

    # 2. Cliente común sin rol admin -> 403
    reg = client.post("/api/auth/register", json={
        "nombre": "User", "apellido": "Atributos", "email": "attr.user@test.co", "contrasena": "ClaveSegura123"
    })
    tok_user = reg.get_json()["data"]["token"]
    h_user = {"Authorization": f"Bearer {tok_user}"}
    assert client.post("/api/admin/tallas", headers=h_user, json={"nombre_talla": "XXL"}).status_code == 403
    assert client.post("/api/admin/colores", headers=h_user, json={"nombre_color": "Cyan", "codigo_hex": "#00FFFF"}).status_code == 403
    assert client.post("/api/admin/categorias", headers=h_user, json={"nombre_categoria": "Casual"}).status_code == 403

    # 3. Administradora autenticada
    tok_adm = _login_admin(client)["token"]
    h_adm = {"Authorization": f"Bearer {tok_adm}"}

    # Atributos iniciales
    res_attr = client.get("/api/admin/atributos", headers=h_adm)
    assert res_attr.status_code == 200
    data_attr = res_attr.get_json()["data"]
    assert "tallas" in data_attr and "colores" in data_attr

    # Creación de nueva categoría
    res_cat = client.post("/api/admin/categorias", headers=h_adm, json={
        "nombre_categoria": "Lencería Fina",
        "descripcion_categoria": "Prendas íntimas de diseñador"
    })
    assert res_cat.status_code == 201
    cat_data = res_cat.get_json()["data"]
    assert cat_data["nombre_categoria"] == "Lencería Fina"
    assert "id_categoria" in cat_data

    # Duplicado de categoría -> 409
    res_cat_dup = client.post("/api/admin/categorias", headers=h_adm, json={
        "nombre_categoria": "Lencería Fina"
    })
    assert res_cat_dup.status_code == 409

    # Creación de nueva talla
    res_talla = client.post("/api/admin/tallas", headers=h_adm, json={
        "nombre_talla": "2XL"
    })
    assert res_talla.status_code == 201
    talla_data = res_talla.get_json()["data"]
    assert talla_data["codigo_talla"] == "2XL"
    assert "id_talla" in talla_data

    # Duplicado de talla -> 409
    res_talla_dup = client.post("/api/admin/tallas", headers=h_adm, json={
        "nombre_talla": "2XL"
    })
    assert res_talla_dup.status_code == 409

    # Talla vacía -> 400
    assert client.post("/api/admin/tallas", headers=h_adm, json={"nombre_talla": "  "}).status_code == 400

    # Creación de nuevo color
    res_color = client.post("/api/admin/colores", headers=h_adm, json={
        "nombre_color": "Verde Esmeralda",
        "codigo_hex": "#0B6623"
    })
    assert res_color.status_code == 201
    color_data = res_color.get_json()["data"]
    assert color_data["nombre_color"] == "Verde Esmeralda"
    assert color_data["codigo_hex"] == "#0B6623"
    assert "id_color" in color_data

    # Duplicado de color -> 409
    res_color_dup = client.post("/api/admin/colores", headers=h_adm, json={
        "nombre_color": "Verde Esmeralda",
        "codigo_hex": "#0B6623"
    })
    assert res_color_dup.status_code == 409

    # Color sin nombre -> 400
    assert client.post("/api/admin/colores", headers=h_adm, json={"nombre_color": "", "codigo_hex": "#123456"}).status_code == 400

    # Verificación en GET /api/admin/atributos
    res_attr_final = client.get("/api/admin/atributos", headers=h_adm)
    assert res_attr_final.status_code == 200
    final_attr = res_attr_final.get_json()["data"]
    codigos_tallas = [t.get("codigo_talla") or t.get("nombre_talla") for t in final_attr["tallas"]]
    nombres_colores = [c.get("nombre_color") for c in final_attr["colores"]]
    assert "2XL" in codigos_tallas
    assert "Verde Esmeralda" in nombres_colores


def test_admin_novedades_y_eliminacion_atributos():
    client = app.test_client()

    # 1. Endpoint público de novedades
    r_nov = client.get("/api/novedades")
    assert r_nov.status_code == 200
    nov_data = r_nov.get_json()["data"]
    assert "titulo" in nov_data and "subtitulo" in nov_data and "items" in nov_data and "productos" in nov_data

    # 2. Modificación de novedades requiere rol administrativo
    assert client.put("/api/admin/novedades/config", json={"titulo": "Test"}).status_code == 401

    reg = client.post("/api/auth/register", json={
        "nombre": "User", "apellido": "Nov", "email": "nov.user@test.co", "contrasena": "ClaveSegura123"
    })
    tok_user = reg.get_json()["data"]["token"]
    assert client.put("/api/admin/novedades/config", headers={"Authorization": f"Bearer {tok_user}"}, json={"titulo": "Test"}).status_code == 403

    tok_adm = _login_admin(client)["token"]
    h_adm = {"Authorization": f"Bearer {tok_adm}"}

    # 3. Administradora modifica configuración de novedades
    r_cfg = client.put("/api/admin/novedades/config", headers=h_adm, json={
        "titulo": "Colección Otoño / Invierno 2026",
        "subtitulo": "Edición Exclusiva",
        "eyebrow": "NUEVOS LANZAMIENTOS",
        "descripcion": "Prendas confeccionadas con siluetas arquitectónicas de vanguardia.",
        "productos_destacados": ["corset-marfil", "corset-canela"]
    })
    assert r_cfg.status_code == 200
    cfg_data = r_cfg.get_json()["data"]
    assert cfg_data["titulo"] == "Colección Otoño / Invierno 2026"
    assert "corset-marfil" in cfg_data["productos_destacados"]

    # 4. CRUD de cápsulas de novedades
    r_item = client.post("/api/admin/novedades/items", headers=h_adm, json={
        "titulo": "Cápsula Seda Pura",
        "tag": "Exclusivo",
        "descripcion": "Diseños exclusivos confeccionados a mano",
        "imagen_url": "img/top-escote.jpg",
        "producto_id": "top-escote"
    })
    assert r_item.status_code == 201
    item_id = r_item.get_json()["data"]["id"]

    # Editar cápsula
    r_item_edit = client.put(f"/api/admin/novedades/items/{item_id}", headers=h_adm, json={
        "titulo": "Cápsula Seda Pura y Encaje",
        "tag": "Tendencia"
    })
    assert r_item_edit.status_code == 200
    assert r_item_edit.get_json()["data"]["titulo"] == "Cápsula Seda Pura y Encaje"

    # Eliminar cápsula
    r_item_del = client.delete(f"/api/admin/novedades/items/{item_id}", headers=h_adm)
    assert r_item_del.status_code == 200

    # 5. Eliminación de categorías, tallas y colores
    # Categoría vinculada a productos activos -> 409
    assert client.delete("/api/admin/categorias/1", headers=h_adm).status_code == 409

    # Categoría nueva sin productos -> 200
    cat_nueva = client.post("/api/admin/categorias", headers=h_adm, json={"nombre_categoria": "Accesorios Temporales"}).get_json()["data"]["id_categoria"]
    assert client.delete(f"/api/admin/categorias/{cat_nueva}", headers=h_adm).status_code == 200

    # Talla vinculada a inventario -> 409
    assert client.delete("/api/admin/tallas/1", headers=h_adm).status_code == 409

    # Talla nueva sin uso -> 200
    talla_nueva = client.post("/api/admin/tallas", headers=h_adm, json={"nombre_talla": "4XL"}).get_json()["data"]["id_talla"]
    assert client.delete(f"/api/admin/tallas/{talla_nueva}", headers=h_adm).status_code == 200

    # Color vinculado a inventario -> 409
    assert client.delete("/api/admin/colores/1", headers=h_adm).status_code == 409

    # Color nuevo sin uso -> 200
    color_nuevo = client.post("/api/admin/colores", headers=h_adm, json={"nombre_color": "Cobre Metalizado", "codigo_hex": "#B87333"}).get_json()["data"]["id_color"]
    assert client.delete(f"/api/admin/colores/{color_nuevo}", headers=h_adm).status_code == 200






