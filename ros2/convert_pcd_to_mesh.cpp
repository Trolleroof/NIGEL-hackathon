#include <pcl/io/pcd_io.h>
#include <pcl/io/ply_io.h>
#include <pcl/point_types.h>
#include <pcl/features/normal_3d.h>
#include <pcl/surface/poisson.h>
#include <pcl/search/kdtree.h>
#include <pcl/filters/voxel_grid.h>
#include <pcl/conversions.h>
#include <iostream>
#include <vector>

int main(int argc, char** argv)
{
    if (argc < 3)
    {
        std::cerr << "Usage: ./convert_pcd_to_mesh input.pcd output.ply\n";
        return -1;
    }

    std::string input_file  = argv[1];
    std::string output_file = argv[2];

    // Load colored point cloud
    pcl::PointCloud<pcl::PointXYZRGB>::Ptr cloud(new pcl::PointCloud<pcl::PointXYZRGB>);
    std::cout << "Loading " << input_file << "...\n";
    if (pcl::io::loadPCDFile(input_file, *cloud) == -1)
    {
        PCL_ERROR("Couldn't read file\n");
        return -1;
    }
    std::cout << "  Loaded " << cloud->size() << " points\n";

    // Downsample with voxel grid (2 cm) to speed things up
    std::cout << "Downsampling (2cm voxel)...\n";
    pcl::VoxelGrid<pcl::PointXYZRGB> vg;
    vg.setInputCloud(cloud);
    vg.setLeafSize(0.02f, 0.02f, 0.02f);
    vg.filter(*cloud);
    std::cout << "  After downsample: " << cloud->size() << " points\n";

    // Estimate normals
    std::cout << "Estimating normals...\n";
    pcl::NormalEstimation<pcl::PointXYZRGB, pcl::Normal> ne;
    ne.setInputCloud(cloud);
    pcl::search::KdTree<pcl::PointXYZRGB>::Ptr tree(new pcl::search::KdTree<pcl::PointXYZRGB>());
    ne.setSearchMethod(tree);
    ne.setKSearch(20);
    pcl::PointCloud<pcl::Normal>::Ptr normals(new pcl::PointCloud<pcl::Normal>);
    ne.compute(*normals);
    std::cout << "  Done.\n";

    // Concatenate XYZ+RGB + normals
    pcl::PointCloud<pcl::PointXYZRGBNormal>::Ptr cloud_with_normals(
        new pcl::PointCloud<pcl::PointXYZRGBNormal>);
    pcl::concatenateFields(*cloud, *normals, *cloud_with_normals);

    // Poisson surface reconstruction
    std::cout << "Poisson reconstruction (depth=9)...\n";
    pcl::Poisson<pcl::PointXYZRGBNormal> poisson;
    poisson.setDepth(9);
    poisson.setInputCloud(cloud_with_normals);
    pcl::PolygonMesh mesh;
    poisson.reconstruct(mesh);
    std::cout << "  Done. Polygons: " << mesh.polygons.size() << "\n";

    // Transfer colors from original cloud to mesh vertices via nearest-neighbor
    std::cout << "Transferring colors to mesh vertices...\n";
    pcl::search::KdTree<pcl::PointXYZRGB>::Ptr color_tree(new pcl::search::KdTree<pcl::PointXYZRGB>());
    color_tree->setInputCloud(cloud);

    // Extract mesh vertices into a cloud so we can colorize them
    pcl::PointCloud<pcl::PointXYZRGB>::Ptr mesh_cloud(new pcl::PointCloud<pcl::PointXYZRGB>);
    pcl::fromPCLPointCloud2(mesh.cloud, *mesh_cloud);

    for (auto& pt : mesh_cloud->points)
    {
        std::vector<int> idx(1);
        std::vector<float> dist(1);
        pcl::PointXYZRGB query;
        query.x = pt.x; query.y = pt.y; query.z = pt.z;
        if (color_tree->nearestKSearch(query, 1, idx, dist) > 0)
        {
            pt.r = cloud->points[idx[0]].r;
            pt.g = cloud->points[idx[0]].g;
            pt.b = cloud->points[idx[0]].b;
        }
    }
    pcl::toPCLPointCloud2(*mesh_cloud, mesh.cloud);
    std::cout << "  Done.\n";

    // Save mesh (PLY preserves vertex colors)
    std::cout << "Saving " << output_file << "...\n";
    pcl::io::savePLYFile(output_file, mesh);
    std::cout << "Done!\n";

    return 0;
}
