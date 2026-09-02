import numpy as np

def generate_point_cloud(objects, config, rng):
    pts = []

    # Road / terrain surface
    xs = np.linspace(-20, 20, 180)
    ys = np.linspace(-14, 14, 100)
    xx, yy = np.meshgrid(xs, ys)
    zz = rng.normal(0, config.noise_std, xx.shape)
    road = np.column_stack([xx.ravel(), yy.ravel(), zz.ravel()])
    pts.append(road)

    # Building/static structure
    bx = rng.uniform(14, 18, 600)
    by = rng.uniform(7, 12, 600)
    bz = rng.uniform(0, 5, 600)
    pts.append(np.column_stack([bx, by, bz]))

    for obj in objects:
        n = 180 if obj.class_name == "pedestrian" else 350
        x = rng.normal(obj.x, 0.45 if obj.class_name == "vehicle" else 0.25, n)
        y = rng.normal(obj.y, 0.45 if obj.class_name == "vehicle" else 0.25, n)
        h = 1.7 if obj.class_name == "pedestrian" else 1.4
        z = rng.uniform(0.0, h, n) + rng.normal(0, config.noise_std, n)
        pts.append(np.column_stack([x, y, z]))

    return np.vstack(pts)
