#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <sensor_msgs/msg/image.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <std_srvs/srv/trigger.hpp>
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>
#include <tf2_sensor_msgs/tf2_sensor_msgs.hpp>

#include <pcl/point_cloud.h>
#include <pcl/point_types.h>
#include <pcl/filters/voxel_grid.h>
#include <pcl_conversions/pcl_conversions.h>

#include <cv_bridge/cv_bridge.h>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

// WebSocket via Boost.Beast (header-only) + Boost.Asio
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>

#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <chrono>

using namespace std::chrono_literals;

namespace beast     = boost::beast;
namespace websocket = beast::websocket;
namespace net       = boost::asio;
using tcp           = net::ip::tcp;

// ─────────────────────────────────────────────────────────────────────────────
// WsSession – one connected WebSocket client (server-push only)
// ─────────────────────────────────────────────────────────────────────────────
class WsSession
{
public:
  explicit WsSession(tcp::socket sock)
  : ws_(std::move(sock)) {}

  bool handshake()
  {
    boost::system::error_code ec;
    ws_.accept(ec);
    if (ec) return false;
    ws_.binary(true);
    return true;
  }

  // Thread-safe write. Returns false when the connection is dead.
  bool send(const void * data, std::size_t size)
  {
    if (dead_.load(std::memory_order_relaxed)) return false;
    std::lock_guard<std::mutex> lk(write_mutex_);
    boost::system::error_code ec;
    ws_.write(net::buffer(data, size), ec);
    if (ec) {
      dead_.store(true, std::memory_order_relaxed);
      return false;
    }
    return true;
  }

  bool isDead() const { return dead_.load(std::memory_order_relaxed); }

private:
  websocket::stream<tcp::socket> ws_;
  std::mutex                     write_mutex_;
  std::atomic<bool>              dead_{false};
};

// ─────────────────────────────────────────────────────────────────────────────
// WsBroadcaster – TCP accept loop + fan-out to all live sessions
// ─────────────────────────────────────────────────────────────────────────────
class WsBroadcaster
{
public:
  WsBroadcaster(uint16_t port, rclcpp::Logger logger)
  : logger_(logger),
    acceptor_(ioc_)
  {
    tcp::endpoint ep(tcp::v4(), port);
    acceptor_.open(ep.protocol());
    acceptor_.set_option(net::socket_base::reuse_address(true));
    acceptor_.bind(ep);
    acceptor_.listen(net::socket_base::max_listen_connections);
    RCLCPP_INFO(logger_, "WebSocket server on ws://0.0.0.0:%u", port);
  }

  ~WsBroadcaster() { stop(); }

  void start()
  {
    accept_thread_ = std::thread([this]() { acceptLoop(); });
  }

  void stop()
  {
    boost::system::error_code ec;
    acceptor_.close(ec);
    if (accept_thread_.joinable()) accept_thread_.join();
  }

  void broadcast(const std::vector<uint8_t> & data)
  {
    std::lock_guard<std::mutex> lk(sessions_mutex_);
    sessions_.erase(
      std::remove_if(sessions_.begin(), sessions_.end(),
        [&](const std::shared_ptr<WsSession> & s) {
          return !s->send(data.data(), data.size());
        }),
      sessions_.end());
  }

  std::size_t clientCount()
  {
    std::lock_guard<std::mutex> lk(sessions_mutex_);
    sessions_.erase(
      std::remove_if(sessions_.begin(), sessions_.end(),
        [](const std::shared_ptr<WsSession> & s) { return s->isDead(); }),
      sessions_.end());
    return sessions_.size();
  }

private:
  void acceptLoop()
  {
    while (true) {
      boost::system::error_code ec;
      tcp::socket sock(ioc_);
      acceptor_.accept(sock, ec);
      if (ec) break;

      auto session = std::make_shared<WsSession>(std::move(sock));
      if (!session->handshake()) continue;

      std::size_t n;
      {
        std::lock_guard<std::mutex> lk(sessions_mutex_);
        sessions_.push_back(session);
        n = sessions_.size();
      }
      RCLCPP_INFO(logger_, "WebSocket client connected (%zu total)", n);
    }
  }

  rclcpp::Logger                           logger_;
  net::io_context                          ioc_;
  tcp::acceptor                            acceptor_;
  std::vector<std::shared_ptr<WsSession>>  sessions_;
  std::mutex                               sessions_mutex_;
  std::thread                              accept_thread_;
};

// ─────────────────────────────────────────────────────────────────────────────
// SlamCloudAccumulator
// ─────────────────────────────────────────────────────────────────────────────
class SlamCloudAccumulator : public rclcpp::Node
{
public:
  SlamCloudAccumulator()
  : Node("slam_cloud_accumulator"),
    tf_buffer_(this->get_clock()),
    tf_listener_(tf_buffer_),
    scans_since_refilter_(0),
    last_image_ws_send_(0, 0, RCL_ROS_TIME),
    last_odom_ws_send_(0, 0, RCL_ROS_TIME)
  {
    // ── Parameters ───────────────────────────────────────────────────────────
    this->declare_parameter("fixed_frame",            "odom");
    this->declare_parameter("input_topic",            "/odin1/cloud_slam");
    this->declare_parameter("voxel_size",             0.05);
    this->declare_parameter("publish_hz",             2.0);
    this->declare_parameter("refilter_every_n_scans", 10);
    this->declare_parameter("ws_port",                9090);
    // camera
    this->declare_parameter("image_topic",            "/odin1/image/undistored");
    this->declare_parameter("image_hz",               10.0);
    this->declare_parameter("jpeg_quality",           80);
    this->declare_parameter("image_scale",            1.0);
    // odometry
    this->declare_parameter("odom_topic",             "/odin1/odometry");
    this->declare_parameter("odom_hz",                20.0);
    this->declare_parameter("path_hz",                1.0);
    this->declare_parameter("max_path_poses",         10000);
    this->declare_parameter("min_path_distance",      0.05);

    fixed_frame_            = this->get_parameter("fixed_frame").as_string();
    input_topic_            = this->get_parameter("input_topic").as_string();
    voxel_size_             = static_cast<float>(this->get_parameter("voxel_size").as_double());
    publish_hz_             = this->get_parameter("publish_hz").as_double();
    refilter_every_n_scans_ = this->get_parameter("refilter_every_n_scans").as_int();
    const int ws_port       = this->get_parameter("ws_port").as_int();

    image_topic_    = this->get_parameter("image_topic").as_string();
    image_hz_       = this->get_parameter("image_hz").as_double();
    jpeg_quality_   = this->get_parameter("jpeg_quality").as_int();
    image_scale_    = this->get_parameter("image_scale").as_double();

    odom_topic_         = this->get_parameter("odom_topic").as_string();
    odom_hz_            = this->get_parameter("odom_hz").as_double();
    path_hz_            = this->get_parameter("path_hz").as_double();
    max_path_poses_     = this->get_parameter("max_path_poses").as_int();
    min_path_distance_  = this->get_parameter("min_path_distance").as_double();

    // ── Point cloud pipeline ─────────────────────────────────────────────────
    accumulated_cloud_ = std::make_shared<pcl::PointCloud<pcl::PointXYZRGB>>();
    voxel_.setLeafSize(voxel_size_, voxel_size_, voxel_size_);

    cloud_pub_ = this->create_publisher<sensor_msgs::msg::PointCloud2>(
      "/slam_cloud_accumulator/cloud", rclcpp::QoS(2).reliable());

    cloud_sub_ = this->create_subscription<sensor_msgs::msg::PointCloud2>(
      input_topic_, rclcpp::SensorDataQoS(),
      std::bind(&SlamCloudAccumulator::cloudCallback, this, std::placeholders::_1));

    auto cloud_period = std::chrono::milliseconds(static_cast<int>(1000.0 / publish_hz_));
    publish_timer_ = this->create_wall_timer(
      cloud_period, std::bind(&SlamCloudAccumulator::publishCloudCallback, this));

    reset_srv_ = this->create_service<std_srvs::srv::Trigger>(
      "/slam_cloud_accumulator/reset",
      std::bind(&SlamCloudAccumulator::resetCallback, this,
                std::placeholders::_1, std::placeholders::_2));

    // ── Camera feed ──────────────────────────────────────────────────────────
    image_sub_ = this->create_subscription<sensor_msgs::msg::Image>(
      image_topic_, rclcpp::SensorDataQoS(),
      std::bind(&SlamCloudAccumulator::imageCallback, this, std::placeholders::_1));

    // ── Odometry ─────────────────────────────────────────────────────────────
    odom_sub_ = this->create_subscription<nav_msgs::msg::Odometry>(
      odom_topic_, rclcpp::SensorDataQoS(),
      std::bind(&SlamCloudAccumulator::odomCallback, this, std::placeholders::_1));

    auto path_period = std::chrono::milliseconds(static_cast<int>(1000.0 / path_hz_));
    path_timer_ = this->create_wall_timer(
      path_period, std::bind(&SlamCloudAccumulator::publishPathCallback, this));

    // ── WebSocket broadcaster ────────────────────────────────────────────────
    ws_broadcaster_ = std::make_unique<WsBroadcaster>(
      static_cast<uint16_t>(ws_port), this->get_logger());
    ws_broadcaster_->start();

    RCLCPP_INFO(this->get_logger(),
      "slam_cloud_accumulator ready.\n"
      "  point cloud : frame='%s', voxel=%.3f m, publish=%.1f Hz\n"
      "  camera      : topic='%s', max %.1f Hz, JPEG q=%d, scale=%.2f\n"
      "  odometry    : topic='%s', max %.1f Hz\n"
      "  path        : broadcast %.1f Hz, max %d poses, min-dist=%.2f m\n"
      "  WebSocket   : ws://localhost:%d",
      fixed_frame_.c_str(), voxel_size_, publish_hz_,
      image_topic_.c_str(), image_hz_, jpeg_quality_, image_scale_,
      odom_topic_.c_str(), odom_hz_,
      path_hz_, max_path_poses_, min_path_distance_,
      ws_port);
  }

  ~SlamCloudAccumulator()
  {
    if (ws_broadcaster_) ws_broadcaster_->stop();
  }

private:
  // ── Wire format helpers ───────────────────────────────────────────────────

  // PTCL — accumulated point cloud
  //
  //   [0..3]        char[4]   'P','T','C','L'
  //   [4..7]        uint32    point count N
  //   [8..8+N*12)   float32[] x,y,z per point
  //   [8+N*12..)    uint8[]   r,g,b per point
  //
  //   const N   = new DataView(buf).getUint32(4, true);
  //   const xyz = new Float32Array(buf, 8, N * 3);
  //   const rgb = new Uint8Array(buf, 8 + N * 12, N * 3);
  //
  static std::vector<uint8_t> serializeCloud(
    const pcl::PointCloud<pcl::PointXYZRGB> & cloud)
  {
    const uint32_t N = static_cast<uint32_t>(cloud.size());
    std::vector<uint8_t> buf(8 + N * 12 + N * 3);
    buf[0]='P'; buf[1]='T'; buf[2]='C'; buf[3]='L';
    std::memcpy(buf.data() + 4, &N, sizeof(N));
    float   * pos = reinterpret_cast<float *>(buf.data() + 8);
    uint8_t * col = buf.data() + 8 + N * 12;
    for (uint32_t i = 0; i < N; ++i) {
      const auto & pt = cloud.points[i];
      pos[i*3+0]=pt.x; pos[i*3+1]=pt.y; pos[i*3+2]=pt.z;
      col[i*3+0]=pt.r; col[i*3+1]=pt.g; col[i*3+2]=pt.b;
    }
    return buf;
  }

  // IMAG — camera frame (JPEG)
  //
  //   [0..3]   char[4]   'I','M','A','G'
  //   [4..]    bytes     complete JPEG file
  //
  //   const blob = new Blob([buf.slice(4)], { type: 'image/jpeg' });
  //   imgEl.src = URL.createObjectURL(blob);
  //
  static std::vector<uint8_t> serializeImage(const cv::Mat & img, int quality)
  {
    std::vector<uint8_t> jpeg;
    cv::imencode(".jpg", img, jpeg, {cv::IMWRITE_JPEG_QUALITY, quality});
    std::vector<uint8_t> frame(4 + jpeg.size());
    frame[0]='I'; frame[1]='M'; frame[2]='A'; frame[3]='G';
    std::memcpy(frame.data() + 4, jpeg.data(), jpeg.size());
    return frame;
  }

  // ODOM — current pose (32 bytes)
  //
  //   [0..3]    char[4]   'O','D','O','M'
  //   [4..7]    float32   x
  //   [8..11]   float32   y
  //   [12..15]  float32   z
  //   [16..19]  float32   qx
  //   [20..23]  float32   qy
  //   [24..27]  float32   qz
  //   [28..31]  float32   qw
  //
  //   const dv = new DataView(buf);
  //   const x  = dv.getFloat32( 4, true);
  //   const y  = dv.getFloat32( 8, true);
  //   const z  = dv.getFloat32(12, true);
  //   const qx = dv.getFloat32(16, true);
  //   const qy = dv.getFloat32(20, true);
  //   const qz = dv.getFloat32(24, true);
  //   const qw = dv.getFloat32(28, true);
  //
  static std::vector<uint8_t> serializeOdom(
    float x, float y, float z,
    float qx, float qy, float qz, float qw)
  {
    std::vector<uint8_t> buf(32);
    buf[0]='O'; buf[1]='D'; buf[2]='O'; buf[3]='M';
    const float vals[7] = {x, y, z, qx, qy, qz, qw};
    std::memcpy(buf.data() + 4, vals, sizeof(vals));
    return buf;
  }

  // PATH — full pose history (positions only)
  //
  //   [0..3]    char[4]   'P','A','T','H'
  //   [4..7]    uint32    pose count N
  //   [8..]     float32[] x,y,z per pose (N * 3 floats)
  //
  //   const N   = new DataView(buf).getUint32(4, true);
  //   const xyz = new Float32Array(buf, 8, N * 3);
  //   // Use as THREE.Line geometry positions directly
  //
  static std::vector<uint8_t> serializePath(
    const std::vector<std::array<float, 3>> & path)
  {
    const uint32_t N = static_cast<uint32_t>(path.size());
    std::vector<uint8_t> buf(8 + N * 12);
    buf[0]='P'; buf[1]='A'; buf[2]='T'; buf[3]='H';
    std::memcpy(buf.data() + 4, &N, sizeof(N));
    float * dst = reinterpret_cast<float *>(buf.data() + 8);
    for (uint32_t i = 0; i < N; ++i) {
      dst[i*3+0] = path[i][0];
      dst[i*3+1] = path[i][1];
      dst[i*3+2] = path[i][2];
    }
    return buf;
  }

  // ── Incoming point cloud ──────────────────────────────────────────────────
  void cloudCallback(const sensor_msgs::msg::PointCloud2::SharedPtr msg)
  {
    sensor_msgs::msg::PointCloud2 transformed;
    try {
      transformed = tf_buffer_.transform(*msg, fixed_frame_, tf2::durationFromSec(0.1));
    } catch (const tf2::TransformException & ex) {
      RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 2000,
        "TF transform failed: %s", ex.what());
      return;
    }

    pcl::PointCloud<pcl::PointXYZRGB> new_cloud;
    pcl::fromROSMsg(transformed, new_cloud);

    pcl::PointCloud<pcl::PointXYZRGB> scan_filtered;
    voxel_.setInputCloud(new_cloud.makeShared());
    voxel_.filter(scan_filtered);

    {
      std::lock_guard<std::mutex> lock(cloud_mutex_);
      *accumulated_cloud_ += scan_filtered;
      scans_since_refilter_++;

      if (scans_since_refilter_ >= refilter_every_n_scans_) {
        pcl::PointCloud<pcl::PointXYZRGB> refiltered;
        voxel_.setInputCloud(accumulated_cloud_);
        voxel_.filter(refiltered);
        *accumulated_cloud_ = std::move(refiltered);
        scans_since_refilter_ = 0;
        RCLCPP_DEBUG(this->get_logger(),
          "Re-filtered accumulated cloud: %zu points", accumulated_cloud_->size());
      }
    }
  }

  // ── Incoming camera frame ─────────────────────────────────────────────────
  void imageCallback(const sensor_msgs::msg::Image::SharedPtr msg)
  {
    if (ws_broadcaster_->clientCount() == 0) return;

    if (image_hz_ > 0.0) {
      const rclcpp::Time now = this->now();
      if ((now - last_image_ws_send_).seconds() < 1.0 / image_hz_) return;
      last_image_ws_send_ = now;
    }

    cv_bridge::CvImageConstPtr cv_ptr;
    try {
      cv_ptr = cv_bridge::toCvShare(msg, "bgr8");
    } catch (const cv_bridge::Exception & e) {
      RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 5000,
        "cv_bridge failed: %s", e.what());
      return;
    }

    cv::Mat to_encode;
    if (image_scale_ < 0.999) {
      cv::resize(cv_ptr->image, to_encode,
                 {}, image_scale_, image_scale_, cv::INTER_LINEAR);
    } else {
      to_encode = cv_ptr->image;
    }

    ws_broadcaster_->broadcast(serializeImage(to_encode, jpeg_quality_));
  }

  // ── Incoming odometry ─────────────────────────────────────────────────────
  void odomCallback(const nav_msgs::msg::Odometry::SharedPtr msg)
  {
    const auto & p = msg->pose.pose.position;
    const auto & q = msg->pose.pose.orientation;

    const float x  = static_cast<float>(p.x);
    const float y  = static_cast<float>(p.y);
    const float z  = static_cast<float>(p.z);
    const float qx = static_cast<float>(q.x);
    const float qy = static_cast<float>(q.y);
    const float qz = static_cast<float>(q.z);
    const float qw = static_cast<float>(q.w);

    // ── Accumulate path (distance-filtered) ──────────────────────────────────
    {
      std::lock_guard<std::mutex> lk(path_mutex_);

      const bool first = path_history_.empty();
      if (first) {
        path_history_.push_back({x, y, z});
      } else {
        const auto & last = path_history_.back();
        const float dx = x - last[0], dy = y - last[1], dz = z - last[2];
        if (std::sqrt(dx*dx + dy*dy + dz*dz) >= static_cast<float>(min_path_distance_)) {
          path_history_.push_back({x, y, z});
          // Trim oldest poses when history is full
          if (static_cast<int>(path_history_.size()) > max_path_poses_) {
            path_history_.erase(path_history_.begin());
          }
        }
      }
    }

    // ── Broadcast current pose (throttled) ───────────────────────────────────
    if (ws_broadcaster_->clientCount() == 0) return;

    if (odom_hz_ > 0.0) {
      const rclcpp::Time now = this->now();
      if ((now - last_odom_ws_send_).seconds() < 1.0 / odom_hz_) return;
      last_odom_ws_send_ = now;
    }

    ws_broadcaster_->broadcast(serializeOdom(x, y, z, qx, qy, qz, qw));
  }

  // ── Point cloud publish timer ─────────────────────────────────────────────
  void publishCloudCallback()
  {
    const bool ros_pub = cloud_pub_->get_subscription_count() > 0;
    const bool ws_pub  = ws_broadcaster_->clientCount() > 0;
    if (!ros_pub && !ws_pub) return;

    sensor_msgs::msg::PointCloud2 out_msg;
    std::vector<uint8_t>          ws_frame;

    {
      std::lock_guard<std::mutex> lock(cloud_mutex_);
      if (accumulated_cloud_->empty()) return;
      if (ros_pub) pcl::toROSMsg(*accumulated_cloud_, out_msg);
      if (ws_pub)  ws_frame = serializeCloud(*accumulated_cloud_);
    }

    if (ros_pub) {
      out_msg.header.frame_id = fixed_frame_;
      out_msg.header.stamp    = this->now();
      cloud_pub_->publish(out_msg);
    }
    if (ws_pub) {
      ws_broadcaster_->broadcast(ws_frame);
    }
  }

  // ── Path broadcast timer ──────────────────────────────────────────────────
  void publishPathCallback()
  {
    if (ws_broadcaster_->clientCount() == 0) return;

    std::vector<uint8_t> frame;
    {
      std::lock_guard<std::mutex> lk(path_mutex_);
      if (path_history_.empty()) return;
      frame = serializePath(path_history_);
    }
    ws_broadcaster_->broadcast(frame);
  }

  // ── Reset service ─────────────────────────────────────────────────────────
  void resetCallback(
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*req*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
  {
    {
      std::lock_guard<std::mutex> lock(cloud_mutex_);
      accumulated_cloud_->clear();
      scans_since_refilter_ = 0;
    }
    {
      std::lock_guard<std::mutex> lk(path_mutex_);
      path_history_.clear();
    }
    response->success = true;
    response->message = "Accumulated cloud and path cleared.";
    RCLCPP_INFO(this->get_logger(), "Accumulated cloud and path reset.");
  }

  // ── Members ───────────────────────────────────────────────────────────────
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr    cloud_pub_;
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr cloud_sub_;
  rclcpp::Subscription<sensor_msgs::msg::Image>::SharedPtr       image_sub_;
  rclcpp::Subscription<nav_msgs::msg::Odometry>::SharedPtr       odom_sub_;
  rclcpp::TimerBase::SharedPtr                                   publish_timer_;
  rclcpp::TimerBase::SharedPtr                                   path_timer_;
  rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr             reset_srv_;

  tf2_ros::Buffer            tf_buffer_;
  tf2_ros::TransformListener tf_listener_;

  pcl::VoxelGrid<pcl::PointXYZRGB>       voxel_;
  pcl::PointCloud<pcl::PointXYZRGB>::Ptr accumulated_cloud_;
  std::mutex                             cloud_mutex_;
  int                                    scans_since_refilter_;

  // Path history: xyz positions, distance-filtered, capped at max_path_poses_
  std::vector<std::array<float, 3>> path_history_;
  std::mutex                        path_mutex_;

  std::string fixed_frame_;
  std::string input_topic_;
  float       voxel_size_;
  double      publish_hz_;
  int         refilter_every_n_scans_;

  std::string  image_topic_;
  double       image_hz_;
  int          jpeg_quality_;
  double       image_scale_;
  rclcpp::Time last_image_ws_send_;

  std::string  odom_topic_;
  double       odom_hz_;
  double       path_hz_;
  int          max_path_poses_;
  double       min_path_distance_;
  rclcpp::Time last_odom_ws_send_;

  std::unique_ptr<WsBroadcaster> ws_broadcaster_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<SlamCloudAccumulator>());
  rclcpp::shutdown();
  return 0;
}
