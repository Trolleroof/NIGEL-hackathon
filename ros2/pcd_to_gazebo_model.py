import open3d as o3d
import numpy as np
import xatlas
from PIL import Image
import os

PCD_FILE = "slam_snapshot_20260220_173148.pcd"
MODEL_DIR = "my_scan_model"
MESH_DIR  = os.path.join(MODEL_DIR, "meshes")
TEX_SIZE  = 4096
TARGET_TRIANGLES = 30000   # simplify target

os.makedirs(MESH_DIR, exist_ok=True)

# ── 1. Load point cloud ───────────────────────────────────────────────────────
print(f"Loading {PCD_FILE}...")
pcd = o3d.io.read_point_cloud(PCD_FILE)
print(f"  {len(pcd.points)} points, has_colors={pcd.has_colors()}")

# ── 2. Poisson reconstruction ─────────────────────────────────────────────────
print("Estimating normals...")
pcd.estimate_normals()
print("Poisson reconstruction (depth=8)...")
mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=8)
print(f"  Raw mesh: {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")

# ── 3. Prune low-density Poisson artifacts ────────────────────────────────────
print("Pruning low-density vertices (Poisson artifacts)...")
densities_np = np.asarray(densities)
threshold = np.percentile(densities_np, 10)   # remove bottom 10%
mesh.remove_vertices_by_mask(densities_np < threshold)
print(f"  After pruning: {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")

# ── 4. Simplify + clean ───────────────────────────────────────────────────────
print(f"Simplifying to ~{TARGET_TRIANGLES} triangles...")
mesh = mesh.simplify_quadric_decimation(TARGET_TRIANGLES)
mesh.remove_degenerate_triangles()
mesh.remove_duplicated_vertices()
mesh.remove_unreferenced_vertices()
print(f"  Final mesh: {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")

# ── 5. Transfer vertex colors via nearest-neighbor ───────────────────────────
print("Transferring colors from point cloud to mesh vertices...")
pcd_tree   = o3d.geometry.KDTreeFlann(pcd)
pcd_colors = np.asarray(pcd.colors)
vertices = np.asarray(mesh.vertices)
faces    = np.asarray(mesh.triangles)
vertex_colors = np.zeros((len(vertices), 3))
for i, v in enumerate(vertices):
    [_, idx, _] = pcd_tree.search_knn_vector_3d(v, 1)
    vertex_colors[i] = pcd_colors[idx[0]]
print("  Done.")

# ── 6. UV unwrap with xatlas ──────────────────────────────────────────────────
print("UV unwrapping with xatlas...")
atlas = xatlas.Atlas()
atlas.add_mesh(vertices.astype(np.float32), faces.astype(np.uint32))
atlas.generate()
vmapping, new_faces, uvs = atlas[0]
new_vertices      = vertices[vmapping]
new_vertex_colors = vertex_colors[vmapping]
print(f"  {len(new_vertices)} vertices after UV remap")

# ── 7. Bake vertex colors to texture ─────────────────────────────────────────
print(f"Baking colors to {TEX_SIZE}x{TEX_SIZE} texture...")
texture = np.zeros((TEX_SIZE, TEX_SIZE, 3), dtype=np.uint8)
px_uvs  = uvs * (TEX_SIZE - 1)

for i, face in enumerate(new_faces):
    if i % 10000 == 0:
        print(f"  {i}/{len(new_faces)}")
    v0, v1, v2 = face
    p0, p1, p2 = px_uvs[v0], px_uvs[v1], px_uvs[v2]
    c0, c1, c2 = new_vertex_colors[v0], new_vertex_colors[v1], new_vertex_colors[v2]

    min_x = max(0,          int(np.floor(min(p0[0], p1[0], p2[0]))))
    max_x = min(TEX_SIZE-1, int(np.ceil (max(p0[0], p1[0], p2[0]))))
    min_y = max(0,          int(np.floor(min(p0[1], p1[1], p2[1]))))
    max_y = min(TEX_SIZE-1, int(np.ceil (max(p0[1], p1[1], p2[1]))))
    if min_x > max_x or min_y > max_y:
        continue

    denom = (p1[1]-p2[1])*(p0[0]-p2[0]) + (p2[0]-p1[0])*(p0[1]-p2[1])
    if abs(denom) < 1e-10:
        continue

    ys, xs = np.mgrid[min_y:max_y+1, min_x:max_x+1]
    w0 = ((p1[1]-p2[1])*(xs-p2[0]) + (p2[0]-p1[0])*(ys-p2[1])) / denom
    w1 = ((p2[1]-p0[1])*(xs-p2[0]) + (p0[0]-p2[0])*(ys-p2[1])) / denom
    w2 = 1.0 - w0 - w1
    mask = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
    if mask.any():
        color = w0[mask,None]*c0 + w1[mask,None]*c1 + w2[mask,None]*c2
        texture[ys[mask], xs[mask]] = np.clip(color * 255, 0, 255).astype(np.uint8)

print("  Baking done.")

# ── 8. Write OBJ + MTL + PNG ──────────────────────────────────────────────────
tex_file = "scan_mesh_texture.png"
obj_path = os.path.join(MESH_DIR, "scan_mesh.obj")
mtl_path = os.path.join(MESH_DIR, "scan_mesh.mtl")
tex_path = os.path.join(MESH_DIR, tex_file)

print(f"Saving texture → {tex_path}")
Image.fromarray(texture).save(tex_path)

print(f"Saving OBJ → {obj_path}")
with open(obj_path, "w") as f:
    f.write("mtllib scan_mesh.mtl\n")
    for v in new_vertices:
        f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
    for uv in uvs:
        f.write(f"vt {uv[0]:.6f} {uv[1]:.6f}\n")
    f.write("usemtl scan_material\n")
    for face in new_faces:
        i0, i1, i2 = face + 1   # 1-indexed
        f.write(f"f {i0}/{i0} {i1}/{i1} {i2}/{i2}\n")

print(f"Saving MTL → {mtl_path}")
with open(mtl_path, "w") as f:
    f.write("newmtl scan_material\n")
    f.write("Ka 1.0 1.0 1.0\n")
    f.write("Kd 1.0 1.0 1.0\n")
    f.write("Ks 0.0 0.0 0.0\n")
    f.write(f"map_Kd {tex_file}\n")

print("\nDone!")
for p in [obj_path, mtl_path, tex_path]:
    print(f"  {p}  ({os.path.getsize(p)/1e6:.1f} MB)")
