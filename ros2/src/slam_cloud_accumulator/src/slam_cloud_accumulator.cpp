#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <std_srvs/srv/trigger.hpp>
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>
#include <tf2_sensor_msgs/tf2_sensor_msgs.hpp>

#include <pcl/point_cloud.h>
#include <pcl/point_types.h>
#include <pcl/filters/voxel_grid.h>
#include <pcl/filters/statistical_outlier_removal.h>
#include <pcl/io/pcd_io.h>
#include <pcl_conversions/pcl_conversions.h>

#include <mutex>
#include <string>
#include <chrono>

using namespace std::chrono_literals;

class SlamCloudAccumulator : public rclcpp::Node
{
public:
  SlamCloudAccumulator()
  : Node("slam_cloud_accumulator"),
    tf_buffer_(this->get_clock()),
    tf_listener_(tf_buffer_),
    accumulating_(false)
  {
    // Parameters
    this->declare_parameter("fixed_frame", "odom");
    this->declare_parameter("voxel_size", 0.02f);
    this->declare_parameter("sor_mean_k", 20);
    this->declare_parameter("sor_std_dev", 2.0);
    this->declare_parameter("output_dir", ".");

    fixed_frame_ = this->get_parameter("fixed_frame").as_string();
    voxel_size_  = static_cast<float>(this->get_parameter("voxel_size").as_double());
    sor_mean_k_  = this->get_parameter("sor_mean_k").as_int();
    sor_std_dev_ = this->get_parameter("sor_std_dev").as_double();
    output_dir_  = this->get_parameter("output_dir").as_string();

    accumulated_cloud_ = std::make_shared<pcl::PointCloud<pcl::PointXYZRGB>>();

    // Publishers
    map_pub_ = this->create_publisher<sensor_msgs::msg::PointCloud2>(
      "/slam_cloud_accumulator/map", rclcpp::QoS(1).transient_local());

    preview_pub_ = this->create_publisher<sensor_msgs::msg::PointCloud2>(
      "/slam_cloud_accumulator/preview", rclcpp::SensorDataQoS());

    preview_timer_ = this->create_wall_timer(
      500ms, std::bind(&SlamCloudAccumulator::previewCallback, this));

    // Subscription
    cloud_sub_ = this->create_subscription<sensor_msgs::msg::PointCloud2>(
      "/odin1/cloud_slam", rclcpp::SensorDataQoS(),
      std::bind(&SlamCloudAccumulator::cloudCallback, this, std::placeholders::_1));

    // Services
    start_srv_ = this->create_service<std_srvs::srv::Trigger>(
      "/start_accumulation",
      std::bind(&SlamCloudAccumulator::startCallback, this,
                std::placeholders::_1, std::placeholders::_2));

    stop_srv_ = this->create_service<std_srvs::srv::Trigger>(
      "/stop_and_save",
      std::bind(&SlamCloudAccumulator::stopCallback, this,
                std::placeholders::_1, std::placeholders::_2));

    RCLCPP_INFO(this->get_logger(),
      "slam_cloud_accumulator ready. Fixed frame: '%s'", fixed_frame_.c_str());
  }

private:
  // ── Cloud callback ──────────────────────────────────────────────────────────
  void cloudCallback(const sensor_msgs::msg::PointCloud2::SharedPtr msg)
  {
    if (!accumulating_) return;

    // Transform to fixed frame
    sensor_msgs::msg::PointCloud2 transformed_msg;
    try {
      transformed_msg = tf_buffer_.transform(*msg, fixed_frame_, tf2::durationFromSec(0.1));
    } catch (const tf2::TransformException & ex) {
      RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 2000,
        "TF transform failed: %s", ex.what());
      return;
    }

    // Convert to PCL and append
    pcl::PointCloud<pcl::PointXYZRGB> pcl_cloud;
    pcl::fromROSMsg(transformed_msg, pcl_cloud);

    std::lock_guard<std::mutex> lock(cloud_mutex_);
    *accumulated_cloud_ += pcl_cloud;
  }

  // ── Preview timer (2 Hz) ────────────────────────────────────────────────────
  void previewCallback()
  {
    if (!accumulating_ || preview_pub_->get_subscription_count() == 0) return;

    sensor_msgs::msg::PointCloud2 out_msg;
    {
      std::lock_guard<std::mutex> lock(cloud_mutex_);
      if (accumulated_cloud_->empty()) return;
      pcl::toROSMsg(*accumulated_cloud_, out_msg);
    }
    out_msg.header.frame_id = fixed_frame_;
    out_msg.header.stamp    = this->now();
    preview_pub_->publish(out_msg);
  }

  // ── Start service ───────────────────────────────────────────────────────────
  void startCallback(
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*req*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
  {
    std::lock_guard<std::mutex> lock(cloud_mutex_);
    accumulated_cloud_->clear();
    accumulating_ = true;
    response->success = true;
    response->message = "Accumulation started.";
    RCLCPP_INFO(this->get_logger(), "Accumulation started.");
  }

  // ── Stop + process + save service ──────────────────────────────────────────
  void stopCallback(
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*req*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
  {
    accumulating_ = false;

    pcl::PointCloud<pcl::PointXYZRGB>::Ptr processed(
      new pcl::PointCloud<pcl::PointXYZRGB>);

    {
      std::lock_guard<std::mutex> lock(cloud_mutex_);
      *processed = *accumulated_cloud_;
    }

    if (processed->empty()) {
      response->success = false;
      response->message = "No points accumulated.";
      RCLCPP_WARN(this->get_logger(), "Stop called but no points were accumulated.");
      return;
    }

    RCLCPP_INFO(this->get_logger(),
      "Processing %zu points...", processed->size());

    // 1. Downsample
    pcl::VoxelGrid<pcl::PointXYZRGB> voxel;
    voxel.setInputCloud(processed);
    voxel.setLeafSize(voxel_size_, voxel_size_, voxel_size_);
    voxel.filter(*processed);
    RCLCPP_INFO(this->get_logger(), "After voxel filter: %zu points", processed->size());

    // 2. Remove noise
    pcl::StatisticalOutlierRemoval<pcl::PointXYZRGB> sor;
    sor.setInputCloud(processed);
    sor.setMeanK(sor_mean_k_);
    sor.setStddevMulThresh(sor_std_dev_);
    sor.filter(*processed);
    RCLCPP_INFO(this->get_logger(), "After SOR filter: %zu points", processed->size());

    // 3. Save with timestamp
    auto now = std::chrono::system_clock::now();
    auto t   = std::chrono::system_clock::to_time_t(now);
    char ts[32];
    std::strftime(ts, sizeof(ts), "%Y%m%d_%H%M%S", std::localtime(&t));
    std::string filename = output_dir_ + "/slam_snapshot_" + ts + ".pcd";

    if (pcl::io::savePCDFileBinary(filename, *processed) == 0) {
      response->success = true;
      response->message = "Saved to " + filename;
      RCLCPP_INFO(this->get_logger(), "Cloud saved to: %s", filename.c_str());
    } else {
      response->success = false;
      response->message = "Failed to save " + filename;
      RCLCPP_ERROR(this->get_logger(), "Failed to save cloud to: %s", filename.c_str());
    }

    // 4. Publish as latched topic for RViz
    sensor_msgs::msg::PointCloud2 out_msg;
    pcl::toROSMsg(*processed, out_msg);
    out_msg.header.frame_id = fixed_frame_;
    out_msg.header.stamp    = this->now();
    map_pub_->publish(out_msg);
    RCLCPP_INFO(this->get_logger(), "Published map cloud on /slam_cloud_accumulator/map");
  }

  // ── Members ─────────────────────────────────────────────────────────────────
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr    map_pub_;
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr    preview_pub_;
  rclcpp::TimerBase::SharedPtr                                   preview_timer_;
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr cloud_sub_;
  rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr start_srv_;
  rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr stop_srv_;

  tf2_ros::Buffer           tf_buffer_;
  tf2_ros::TransformListener tf_listener_;

  pcl::PointCloud<pcl::PointXYZRGB>::Ptr accumulated_cloud_;
  std::mutex cloud_mutex_;
  bool       accumulating_;

  std::string fixed_frame_;
  float       voxel_size_;
  int         sor_mean_k_;
  double      sor_std_dev_;
  std::string output_dir_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<SlamCloudAccumulator>());
  rclcpp::shutdown();
  return 0;
}
